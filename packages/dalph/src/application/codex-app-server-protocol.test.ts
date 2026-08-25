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
import {
  CodexOwnedTurnToken,
  CodexThreadOwnershipToken,
  CodexTurnId,
  memoryCodexAttemptStoreLayer
} from "./codex-attempt-store.js"
import { isolatedCodexProcessNativeService } from "../../test-support/isolated-codex-process-native.js"

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
const responseFor = (method, params = {}) => {
  if (mode === "initialize-rpc-error" && method === "initialize") return { error: true }
  if (mode === "initialize-family-contradiction" && method === "initialize") {
    return { userAgent: "fixture-codex/protocol", codexHome: "/tmp/fixture-codex", platformFamily: "windows", platformOs: "linux" }
  }
  if (mode === "rpc-error" && method === "thread/start") return { error: true }
  if (mode === "response-not-object" && method === "thread/start") return "not-an-object"
  if (mode === "read-response-not-object" && method === "thread/read") return "not-an-object"
  if (mode === "resume-response-not-object" && method === "thread/resume") return "not-an-object"
  if (mode === "thread-list-not-array" && method === "thread/list") return { data: {} }
  if (mode === "thread-list-rpc-error" && method === "thread/list") return { error: true }
  if (mode === "thread-list-invalid-item" && method === "thread/list") return { data: [null] }
  if (mode === "thread-list-invalid-fields" && method === "thread/list") {
    return { data: [{ ...validThread, cwd: "", status: "unknown" }] }
  }
  if (mode === "thread-list-valid" && method === "thread/list") return { data: [validThread] }
  if (mode === "thread-list-threads-key" && method === "thread/list") return { threads: [validThread] }
  if (mode === "thread-list-missing-status" && method === "thread/list") {
    const { status: _status, ...threadWithoutStatus } = validThread
    return { data: [threadWithoutStatus] }
  }
  if (mode === "thread-list-paginated" && method === "thread/list") {
    return params.cursor === "page-two"
      ? { data: [{ ...validThread, id: "protocol-thread-two", cwd: "/fixture/worktree-two" }], nextCursor: null }
      : { data: [validThread], nextCursor: "page-two" }
  }
  if (mode === "thread-list-repeated-cursor" && method === "thread/list") {
    return { data: [validThread], nextCursor: "same-page" }
  }
  if (mode === "thread-list-invalid-cursor" && method === "thread/list") {
    return { data: [validThread], nextCursor: 42 }
  }
  if (mode === "thread-start-owned-token" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        ownedThreadToken: params.metadata?.dalphOwnedThreadToken
      }
    }
  }
  if (mode === "thread-start-metadata-token" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        metadata: { dalphOwnedThreadToken: params.metadata?.dalphOwnedThreadToken }
      }
    }
  }
  if (mode === "thread-start-invalid-metadata-token" && method === "thread/start") {
    return { thread: { ...validThread, metadata: { dalphOwnedThreadToken: 42 } } }
  }
  if (mode === "turn-response-not-object" && method === "turn/start") return "not-an-object"
  if (mode === "background-response-not-object" && method === "thread/backgroundTerminals/list") return "not-an-object"
  if (mode === "terminate-response-not-object" && method === "thread/backgroundTerminals/terminate") return "not-an-object"
  if (mode === "interrupt-rpc-error" && method === "turn/interrupt") return { error: true }
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
  if (mode === "invalid-turn-correlation-shape" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, correlation: "not-an-object" }] } }
  }
  if (mode === "invalid-turn-correlation-empty" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, correlation: { runId: "", attemptId: "" } }] } }
  }
  if (mode === "invalid-turn-token" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, ownedTurnToken: 42 }] } }
  }
  if (mode === "invalid-turn-token-empty" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, ownedTurnToken: "" }] } }
  }
  if (mode === "invalid-turn-input-item" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, input: [null] }] } }
  }
  if (mode === "thread-no-turns" && method === "thread/start") {
    const { turns: _turns, ...threadWithoutTurns } = validThread
    return { thread: threadWithoutTurns }
  }
  if (mode === "thread-turn-items-omitted" && method === "thread/start") {
    const { items: _items, ...turnWithoutItems } = validTurn
    return { thread: { ...validThread, turns: [turnWithoutItems] } }
  }
  if (mode === "thread-status-not-loaded" && method === "thread/start") {
    return { thread: { ...validThread, status: "notLoaded" } }
  }
  if (mode === "thread-status-system-error" && method === "thread/start") {
    return { thread: { ...validThread, status: "systemError" } }
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
  if (mode === "thread-correlation" && method === "thread/start") {
    return { thread: { ...validThread, correlation: { runId: "run:protocol", attemptId: "attempt:protocol" } } }
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
  if (mode === "background-valid-number-pid" && method === "thread/backgroundTerminals/list") {
    return { data: [{ processId: "p", itemId: "i", command: "echo", cwd: "/fixture", osPid: 42 }] }
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
              : method === "thread/list"
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
  if (mode === "non-object-message" && requestNumber === 1) {
    process.stdout.write(JSON.stringify("not-an-object") + "\n")
    return
  }
  if (mode === "malformed-json" && message.method === "thread/start") {
    process.stdout.write("not-json\n")
    return
  }
  const response = responseFor(message.method, message.params)
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
      const layer = codexAppServerNodeLayer({ executable }, isolatedCodexProcessNativeService).pipe(
        Layer.provide(memoryCodexAttemptStoreLayer())
      )
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
      ["invalid-turn-correlation-shape", "thread/start"],
      ["invalid-turn-correlation-empty", "thread/start"],
      ["invalid-turn-token", "thread/start"],
      ["invalid-turn-token-empty", "thread/start"],
      ["thread-start-invalid-metadata-token", "thread/start"],
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

    const boundaries = yield* withFixture("happy", (app) =>
      Effect.gen(function* () {
        const started = yield* app.startThread("/fixture/worktree")
        expect((yield* app.readThread(started.id)).id).toBe(started.id)
        expect((yield* app.resumeThread(started.id, "/fixture/worktree")).cwd).toBe("/fixture/worktree")
        const startedTurn = yield* app.startTurn(started.id, "/fixture/worktree", "work")
        yield* app.interruptTurn(started.id, startedTurn.id)
        expect(yield* app.listBackgroundTerminals(started.id)).toEqual([])
        expect(yield* app.terminateBackgroundTerminal(started.id, "terminal")).toBe(true)
        return startedTurn.id
      })
    )
    expect(boundaries).toBe("protocol-turn")

    const status = yield* withFixture("status-object", (app) =>
      Effect.map(app.startThread("/fixture/worktree"), (thread) => thread.status)
    )
    expect(status).toBe("idle")

    const threadCorrelation = yield* withFixture("thread-correlation", (app) =>
      Effect.map(app.startThread("/fixture/worktree"), (thread) => thread.correlation)
    )
    expect(threadCorrelation).toEqual({ runId: "run:protocol", attemptId: "attempt:protocol" })

    for (const mode of ["thread-no-turns", "thread-turn-items-omitted"] as const) {
      const started = yield* withFixture(mode, (app) => app.startThread("/fixture/worktree"))
      expect(started.turns).toEqual(
        mode === "thread-no-turns" ? [] : [{ id: CodexTurnId.make("protocol-turn"), status: "completed", items: [] }]
      )
    }
    for (const mode of ["thread-status-not-loaded", "thread-status-system-error"] as const) {
      const started = yield* withFixture(mode, (app) => app.startThread("/fixture/worktree"))
      expect(started.status).toBe(mode === "thread-status-not-loaded" ? "notLoaded" : "systemError")
    }

    const ignoredInputShape = yield* withFixture("invalid-turn-input-item", (app) =>
      Effect.map(app.startThread("/fixture/worktree"), (thread) => thread.id)
    )
    expect(ignoredInputShape).toBe("protocol-thread")
  })
)

it.effect("reads a complete persistent thread list and preserves malformed-list failures", () =>
  Effect.gen(function* () {
    const listed = yield* withFixture("thread-list-valid", (app) => {
      if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
      return Effect.map(app.listThreads(), (threads) => threads.map((thread) => thread.id))
    })
    expect(listed).toEqual(["protocol-thread"])

    const owned = yield* withFixture("thread-start-owned-token", (app) =>
      Effect.map(
        app.startThread("/fixture/worktree", CodexThreadOwnershipToken.make("owned-thread")),
        (thread) => thread.ownedThreadToken
      )
    )
    expect(owned).toBe("owned-thread")

    const metadataOwned = yield* withFixture("thread-start-metadata-token", (app) =>
      Effect.map(
        app.startThread("/fixture/worktree", CodexThreadOwnershipToken.make("metadata-owned-thread")),
        (thread) => thread.ownedThreadToken
      )
    )
    expect(metadataOwned).toBe("metadata-owned-thread")

    const missingStatus = yield* withFixture("thread-list-missing-status", (app) => {
      if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
      return Effect.map(app.listThreads(), (threads) => threads[0]?.status)
    })
    expect(missingStatus).toBe("idle")

    const alternateKey = yield* withFixture("thread-list-threads-key", (app) => {
      if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
      return Effect.map(app.listThreads(), (threads) => threads.map((thread) => thread.id))
    })
    expect(alternateKey).toEqual(["protocol-thread"])

    const paginated = yield* withFixture("thread-list-paginated", (app) => {
      if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
      return Effect.map(app.listThreads(), (threads) => threads.map((thread) => thread.id))
    })
    expect(paginated).toEqual(["protocol-thread", "protocol-thread-two"])

    for (const mode of [
      "thread-list-not-array",
      "thread-list-invalid-item",
      "thread-list-invalid-fields",
      "thread-list-rpc-error"
    ] as const) {
      const result = yield* withFixture(mode, (app) => {
        if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
        return Effect.exit(app.listThreads())
      })
      expectAppFailure(result, "thread/list")
    }

    for (const mode of ["thread-list-repeated-cursor", "thread-list-invalid-cursor"] as const) {
      const result = yield* withFixture(mode, (app) => {
        if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
        return Effect.exit(app.listThreads())
      })
      expectAppFailure(result, "thread/list")
    }
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

it.effect("keeps every real RPC operation failure typed at its public boundary", () =>
  Effect.forEach(
    [
      ["read-response-not-object", "thread/read"] as const,
      ["resume-response-not-object", "thread/resume"] as const,
      ["turn-response-not-object", "turn/start"] as const,
      ["background-response-not-object", "thread/backgroundTerminals/list"] as const,
      ["terminate-response-not-object", "thread/backgroundTerminals/terminate"] as const,
      ["interrupt-rpc-error", "turn/interrupt"] as const
    ],
    ([mode, operation]) =>
      withFixture(mode, (app) =>
        Effect.gen(function* () {
          const started = yield* app.startThread("/fixture/worktree")
          const result = yield* Effect.exit(
            operation === "thread/read"
              ? app.readThread(started.id)
              : operation === "thread/resume"
                ? app.resumeThread(started.id, "/fixture/worktree")
                : operation === "turn/start"
                  ? app.startTurn(started.id, "/fixture/worktree", "work")
                  : operation === "thread/backgroundTerminals/list"
                    ? app.listBackgroundTerminals(started.id)
                    : operation === "thread/backgroundTerminals/terminate"
                      ? app.terminateBackgroundTerminal(started.id, "terminal")
                      : app.interruptTurn(started.id, CodexTurnId.make("protocol-turn"))
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

    const numericPid = yield* withFixture("background-valid-number-pid", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        return yield* app.listBackgroundTerminals(thread.id)
      })
    )
    expect(numericPid[0]?.osPid).toBe(42)

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
      ["initialize-family-contradiction", "initialize"],
      ["non-object-message", "initialize"]
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

it("selects the node process-native layer when no test-native override is supplied", () => {
  expect(codexAppServerNodeLayer()).toBeDefined()
})
