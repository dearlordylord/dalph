/* eslint-disable import/no-nodejs-modules -- this test launches only local protocol fixtures. */
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import type { PlatformError } from "effect"
import { Cause, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Option, Path, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect, expectTypeOf } from "vitest"
import {
  CodexAppServer,
  CodexAppServerFailure,
  type CodexAppServerRequestBoundary,
  type CodexAppServerService,
  type CodexThreadListSummary,
  type CodexThreadSnapshot,
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
const fs = require("node:fs")
const path = require("node:path")
let buffer = ""
let requestNumber = 0
let threadReadNumber = 0
let lostTurnToken
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
const writeVersionless = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\n")
const writeError = (id) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "fixture failure" } }) + "\n")
const responseFor = (method, params = {}) => {
  if (mode === "turn-start-unanswered-then-read" && method === "thread/read") {
    return {
      thread: {
        ...validThread,
        status: "active",
        turns: [{ ...validTurn, status: "inProgress", ownedTurnToken: lostTurnToken }]
      }
    }
  }
  if (mode === "non-openai-provider-credential" && method === "initialize") {
    const argumentsAreExact = process.argv.slice(2).join("\n") === '-c\napproval_policy="never"\n-c\nsandbox_mode="danger-full-access"\napp-server'
    return process.env.DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL === "fixture-provider-key" && argumentsAreExact
      ? { userAgent: "fixture-codex/protocol", codexHome: "/tmp/fixture-codex", platformFamily: "unix", platformOs: "linux" }
      : { userAgent: "", codexHome: "", platformFamily: "unix", platformOs: "linux" }
  }
  if (mode === "unattended-policy" && method === "initialize") {
    const argumentsAreExact = process.argv.slice(2).join("\n") === '-c\napproval_policy="never"\n-c\nsandbox_mode="danger-full-access"\napp-server'
    return argumentsAreExact
      ? { userAgent: "fixture-codex/protocol", codexHome: "/tmp/fixture-codex", platformFamily: "unix", platformOs: "linux" }
      : { userAgent: "", codexHome: "", platformFamily: "unix", platformOs: "linux" }
  }
  if (method === "config/read") {
    return mode === "unsupported-unattended-policy"
      ? { config: { approval_policy: "on-request", sandbox_mode: "workspace-write" } }
      : { config: { approval_policy: "never", sandbox_mode: "danger-full-access" } }
  }
  if (method === "thread/turns/list") {
    return mode === "thread-turns-list-hydration"
      ? { data: [{ ...validTurn, id: "protocol-turn-hydrated", items: params.itemsView === "full" ? validTurn.items : [] }], nextCursor: null }
      : { error: true }
  }
  if (method === "thread/loaded/list") {
    if (mode === "loaded-thread-repeated-cursor") return { data: [], nextCursor: "repeated" }
    if (mode === "loaded-thread-census") return params.cursor === undefined
      ? { data: [validThread.id], nextCursor: "second" }
      : { data: [validThread.id], nextCursor: null }
    return { data: [], nextCursor: null }
  }
  if (mode === "thread-turns-list-hydration" && (method === "thread/read" || method === "thread/resume")) {
    return { thread: { ...validThread, historyMode: "paginated" } }
  }
  if (mode === "loaded-thread-census" && method === "thread/list") return { data: [], nextCursor: null }
  if (mode === "loaded-thread-census" && method === "thread/read") {
    return { thread: { ...validThread, threadSource: "dalph-integrator-thread:v1:loaded-owned" } }
  }
  if (mode === "unattended-policy" && method === "thread/start") {
    return params.approvalPolicy === "never" && params.sandbox === "danger-full-access"
      ? { thread: validThread }
      : { thread: null }
  }
  if (mode === "unattended-policy" && method === "turn/start") {
    return params.approvalPolicy === "never" && params.sandboxPolicy?.type === "dangerFullAccess"
      ? { turn: validTurn }
      : { turn: null }
  }
  if (mode === "initialize-rpc-error" && method === "initialize") return { error: true }
  if (mode === "initialize-family-contradiction" && method === "initialize") {
    return { userAgent: "fixture-codex/protocol", codexHome: "/tmp/fixture-codex", platformFamily: "windows", platformOs: "linux" }
  }
  if (mode === "rpc-error" && method === "thread/start") return { error: true }
  if (mode === "response-not-object" && method === "thread/start") return "not-an-object"
  if (mode === "read-response-not-object" && method === "thread/read") return "not-an-object"
  if (mode === "resume-response-not-object" && method === "thread/resume") return "not-an-object"
  if (mode === "turn-census-omitted" && (method === "thread/read" || method === "thread/resume")) {
    const { turns: _turns, ...threadWithoutTurns } = validThread
    return { thread: threadWithoutTurns }
  }
  if (mode === "turn-census-malformed" && (method === "thread/read" || method === "thread/resume")) {
    return { thread: { ...validThread, turns: {} } }
  }
  if (mode === "turn-census-omitted" && method === "turn/start") {
    fs.writeFileSync(path.join(params.cwd, "turn-started"), "started")
    return { turn: validTurn }
  }
  if (mode === "thread-list-not-array" && method === "thread/list") return { data: {} }
  if (mode === "thread-list-rpc-error" && method === "thread/list") return { error: true }
  if (mode === "thread-list-invalid-item" && method === "thread/list") return { data: [null] }
  if (mode === "thread-list-invalid-fields" && method === "thread/list") {
    return { data: [{ ...validThread, cwd: "", status: "unknown" }] }
  }
  if (mode === "thread-list-invalid-status" && method === "thread/list") {
    return { data: [{ ...validThread, status: "unknown" }] }
  }
  if (mode === "thread-list-invalid-correlation" && method === "thread/list") {
    return { data: [{ ...validThread, correlation: { runId: "run" } }] }
  }
  if (mode === "thread-list-invalid-token" && method === "thread/list") {
    return { data: [{ ...validThread, threadSource: 42 }] }
  }
  if (mode === "thread-list-malformed-nested-item" && method === "thread/list") {
    return { data: [{ ...validThread, turns: [{ ...validTurn, items: [{ type: null }] }] }] }
  }
  if (mode === "thread-list-valid" && method === "thread/list") return { data: [validThread] }
  if (mode === "thread-list-threads-key" && method === "thread/list") return { threads: [validThread] }
  if (mode === "thread-list-identical-aliases" && method === "thread/list") {
    return { data: [validThread], threads: [validThread], nextCursor: null, next_cursor: null }
  }
  if (mode === "thread-list-contradictory-values" && method === "thread/list") {
    return { data: [], threads: [validThread] }
  }
  if (mode === "thread-list-contradictory-cursors" && method === "thread/list") {
    return { data: [validThread], nextCursor: null, next_cursor: "hidden-page" }
  }
  if (mode === "thread-list-missing-values" && method === "thread/list") return { nextCursor: null }
  if (mode === "thread-list-missing-status" && method === "thread/list") {
    const { status: _status, ...threadWithoutStatus } = validThread
    return { data: [threadWithoutStatus] }
  }
  if (mode === "thread-list-missing-turns" && method === "thread/list") {
    const { turns: _turns, ...threadWithoutTurns } = validThread
    return { data: [threadWithoutTurns] }
  }
  if (mode === "thread-list-identity-only" && method === "thread/list") {
    const { status: _status, turns: _turns, ...threadIdentity } = validThread
    return { data: [threadIdentity] }
  }
  if (mode === "thread-list-paginated" && method === "thread/list") {
    if (params.cursor !== "page-two") return { data: [validThread], nextCursor: "page-two" }
    const { status: _status, turns: _turns, ...threadIdentity } = validThread
    return {
      data: [{ ...threadIdentity, id: "protocol-thread-two", cwd: "/fixture/worktree-two" }],
      nextCursor: null
    }
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
        threadSource: params.threadSource
      }
    }
  }
  if (mode === "thread-start-metadata-token" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        threadSource: params.threadSource,
        metadata: { dalphOwnedThreadToken: "ignored-unsupported-field" }
      }
    }
  }
  if (mode === "thread-start-invalid-metadata-token" && method === "thread/start") {
    return { thread: { ...validThread, threadSource: 42 } }
  }
  if (mode === "thread-start-invalid-direct-token" && method === "thread/start") {
    return { thread: { ...validThread, threadSource: "dalph-integrator-thread:v1:" } }
  }
  if (mode === "thread-start-contradictory-tokens" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        threadSource: { invalid: true }
      }
    }
  }
  if (mode === "turn-response-not-object" && method === "turn/start") return "not-an-object"
  if (mode === "background-response-not-object" && method === "thread/backgroundTerminals/list") return "not-an-object"
  if (mode === "terminate-response-not-object" && method === "thread/backgroundTerminals/terminate") return "not-an-object"
  if (mode === "interrupt-rpc-error" && method === "turn/interrupt") return { error: true }
  if (mode === "missing-thread" && method === "thread/start") return {}
  if (mode === "invalid-thread-fields" && method === "thread/start") {
    return { thread: { id: "", cwd: "", status: "unknown", turns: [] } }
  }
  if (mode === "thread-start-missing-status" && method === "thread/start") {
    const { status: _status, ...threadWithoutStatus } = validThread
    return { thread: threadWithoutStatus }
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
  if (mode === "turn-marker-top-level-input-text" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{ ...validTurn, items: [{ type: "input_text", text: "<!-- dalph-owned-turn-token:v1:provider -->" }] }]
      }
    }
  }
  if (mode === "turn-marker-assistant-message" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{
          ...validTurn,
          items: [{ type: "agentMessage", role: "assistant", content: [{ type: "input_text", text: "<!-- dalph-owned-turn-token:v1:provider -->" }] }]
        }]
      }
    }
  }
  if (mode === "turn-marker-provider-prose" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{ ...validTurn, items: [{ type: "providerMessage", text: "<!-- dalph-owned-turn-token:v1:provider -->" }] }]
      }
    }
  }
  if (mode === "turn-marker-malformed-user-message" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{ ...validTurn, items: [{ type: "userMessage", content: [{ type: "input_text", text: 42 }] }] }]
      }
    }
  }
  if (mode === "turn-marker-malformed-item-discriminator" && method === "thread/start") {
    return { thread: { ...validThread, turns: [{ ...validTurn, items: [{ type: null }] }] } }
  }
  if (mode === "turn-marker-malformed-content-discriminator" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{ ...validTurn, items: [{ type: "userMessage", content: [{ type: null }] }] }]
      }
    }
  }
  if (mode === "turn-marker-non-input-content" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{ ...validTurn, items: [{ type: "userMessage", content: [{ type: "output_text", text: "ignored" }] }] }]
      }
    }
  }
  if (mode === "turn-marker-contradictory-user-message" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{
          ...validTurn,
          items: [{ type: "agentMessage", role: "user", content: [{ type: "input_text", text: "<!-- dalph-owned-turn-token:v1:provider -->" }] }]
        }]
      }
    }
  }
  if (mode === "turn-marker-user-message" && method === "thread/start") {
    return {
      thread: {
        ...validThread,
        turns: [{
          ...validTurn,
          items: [{ type: "userMessage", content: [{ type: "input_text", text: "<!-- dalph-owned-turn-token:v1:user-owned -->" }] }]
        }]
      }
    }
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
  if (mode === "invalid-thread-correlation-shape" && method === "thread/start") {
    return { thread: { ...validThread, correlation: "not-an-object" } }
  }
  if (mode === "invalid-thread-correlation-empty" && method === "thread/start") {
    return { thread: { ...validThread, correlation: { runId: "", attemptId: "" } } }
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
  if (message.method === "thread/read" && message.params?.includeTurns === true) threadReadNumber += 1
  if (mode === "unmaterialized-thread" && message.method === "thread/read" && message.params?.includeTurns === true) {
    process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32600, message: "thread protocol-thread is not materialized yet; includeTurns is unavailable before first user message" } }) + "\n")
    return
  }
  if (mode === "versionless-envelope" && (message.method === "initialize" || message.method === "thread/start")) {
    writeVersionless(message.id, responseFor(message.method, message.params))
    if (message.method === "thread/start") {
      process.stdout.write(JSON.stringify({ method: "turn/completed", params: { opaque: true } }) + "\n")
    }
    return
  }
  if (mode === "invalid-jsonrpc-version" && requestNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "1.0", id: message.id, result: {} }) + "\n")
    return
  }
  if (mode.startsWith("malformed-envelope-") && requestNumber === 1) {
    const envelope =
      mode === "malformed-envelope-method"
        ? { jsonrpc: "2.0", method: 1 }
        : mode === "malformed-envelope-notification-result"
          ? { jsonrpc: "2.0", method: "fixture/notice", result: {} }
          : mode === "malformed-envelope-server-result"
            ? { jsonrpc: "2.0", id: message.id, method: "fixture/request", result: {} }
            : mode === "malformed-envelope-server-id"
              ? { jsonrpc: "2.0", id: {}, method: "fixture/request" }
              : mode === "malformed-envelope-response-id"
                ? { jsonrpc: "2.0", id: 0, result: {} }
                : mode === "malformed-envelope-response-both"
                  ? { jsonrpc: "2.0", id: message.id, result: {}, error: {} }
                  : mode === "malformed-envelope-response-neither"
                    ? { jsonrpc: "2.0", id: message.id }
                    : { jsonrpc: "2.0", id: message.id, error: "invalid" }
    process.stdout.write(JSON.stringify(envelope) + "\n")
    return
  }
  if (mode === "idle-malformed-before-next-request") {
    fs.appendFileSync(process.argv[1] + ".requests", message.method + "\n")
  }
  if (mode === "malformed-during-admission" || mode === "malformed-after-pending") {
    fs.appendFileSync(process.argv[1] + ".requests", message.method + "\n")
  }
  if (mode === "malformed-after-pending" && message.method === "thread/read") {
    fs.writeFileSync(process.argv[1] + ".pending", "pending")
    return
  }
  if (
    (mode === "initialize-unanswered" && message.method === "initialize") ||
    (mode === "thread-start-unanswered" && message.method === "thread/start") ||
    (mode === "thread-read-unanswered" && message.method === "thread/read") ||
    (mode === "thread-resume-unanswered" && message.method === "thread/resume") ||
    (mode === "background-list-unanswered" && message.method === "thread/backgroundTerminals/list")
  ) {
    fs.writeFileSync(process.argv[1] + ".received", message.method)
    return
  }
  if (mode === "turn-start-unanswered-then-read" && message.method === "turn/start") {
    const text = message.params?.input?.[0]?.text ?? ""
    lostTurnToken = /<!-- dalph-owned-turn-token:v1:([^ ]+) -->/.exec(text)?.[1]
    fs.writeFileSync(process.argv[1] + ".received", message.method)
    return
  }
  if (mode === "stderr-noise" && requestNumber === 1) process.stderr.write("diagnostic-only\n")
  if (mode === "blank-line" && requestNumber === 1) process.stdout.write("\n")
  if (mode === "non-number-response-id" && requestNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: "bad", result: {} }) + "\n")
    return
  }
  if (mode === "server-request-id-collision" && requestNumber === 1) {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: message.id, method: "server/request", params: { opaque: true } }) + "\n"
    )
  }
  if (mode === "malformed-envelope" && requestNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0" }) + "\n")
  }
  if (mode === "idle-malformed-before-next-request" && message.method === "thread/start") {
    write(message.id, responseFor(message.method, message.params))
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0" }) + "\n")
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed" }) + "\n")
    return
  }
  if (mode === "unknown-response-id" && requestNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 999, result: {} }) + "\n")
  }
  if (mode === "no-id-response" && requestNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "fixture/notice" }) + "\n")
  }
  if (mode === "turn-completed-hint" && message.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { opaque: true } }) + "\n")
  }
  if (mode === "owned-activity-hint" && message.method === "thread/start") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "item/completed", params: { opaque: true } }) + "\n")
  }
  if (mode === "turn-completed-burst" && message.method === "thread/start") {
    for (let index = 0; index < 64; index += 1) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "thread/status/changed", params: { index } }) + "\n")
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { index } }) + "\n")
    }
  }
  if (mode === "turn-completed-burst" && message.method === "thread/read" && message.params?.includeTurns === true && threadReadNumber === 1) {
    for (let index = 0; index < 64; index += 1) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "thread/status/changed", params: { index } }) + "\n")
    }
  }
  if (mode === "turn-completed-burst" && message.method === "thread/read" && message.params?.includeTurns === true && threadReadNumber === 2) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { terminal: true } }) + "\n")
  }
  if (mode === "unexpected-approval-request" && message.method === "turn/start") {
    write(message.id, responseFor(message.method, message.params))
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: { reason: "must never be requested" }
    }) + "\n")
    return
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
if (mode === "malformed-during-admission" || mode === "malformed-after-pending") {
  const malformedTrigger = process.argv[1] + ".malformed"
  const malformedSent = process.argv[1] + ".malformed-sent"
  const poll = setInterval(() => {
    if (!fs.existsSync(malformedTrigger)) return
    clearInterval(poll)
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0" }) + "\n")
    if (mode === "malformed-during-admission") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed" }) + "\n")
    }
    fs.writeFileSync(malformedSent, "sent")
  }, 1)
}
process.on("SIGTERM", () => {
  fs.appendFileSync(process.argv[1] + ".closed", "closed\n")
  process.exit(0)
})
`

const fixtureFilePollAttemptLimit = 1_000 // eslint-disable-line no-magic-numbers -- deterministic fixture setup bound

const awaitFile = (
  fileSystem: FileSystem.FileSystem,
  file: string,
  remaining: number = fixtureFilePollAttemptLimit
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.suspend(() =>
    remaining <= 0
      ? Effect.die(`fixture did not create ${file} within ${fixtureFilePollAttemptLimit} observations`)
      : fileSystem
          .exists(file)
          .pipe(
            Effect.flatMap((exists) =>
              exists ? Effect.void : Effect.yieldNow.pipe(Effect.andThen(awaitFile(fileSystem, file, remaining - 1)))
            )
          )
  )

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

const withFixture = <A>(
  mode: string,
  action: (app: CodexAppServerService, root: string) => Effect.Effect<A, unknown, FileSystem.FileSystem | Path.Path>,
  config: {
    readonly environment?: Readonly<Record<string, string>>
    readonly requireUnattendedPolicy?: boolean
    readonly requestBoundary?: CodexAppServerRequestBoundary
  } = {}
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `dalph-protocol-${mode}-` })
      const executable = path.join(root, mode)
      yield* fileSystem.writeFileString(executable, protocolFixture)
      yield* fileSystem.chmod(executable, 0o755)
      const { requestBoundary, ...serverConfig } = config
      const layer = codexAppServerNodeLayer(
        { ...serverConfig, executable },
        isolatedCodexProcessNativeService,
        requestBoundary
      ).pipe(Layer.provide(memoryCodexAttemptStoreLayer()))
      return yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        return yield* action(app, root).pipe(Effect.ensuring(app.close.pipe(Effect.orDie)))
      }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer))
    }).pipe(Effect.provide(NodeServices.layer))
  )

const unansweredFixture = (
  mode:
    | "initialize-unanswered"
    | "thread-start-unanswered"
    | "thread-read-unanswered"
    | "thread-resume-unanswered"
    | "background-list-unanswered",
  action: (app: CodexAppServerService) => Effect.Effect<unknown, CodexAppServerFailure>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `dalph-protocol-${mode}-` })
      const executable = path.join(root, mode)
      yield* fileSystem.writeFileString(executable, protocolFixture)
      yield* fileSystem.chmod(executable, 0o755)
      const layer = codexAppServerNodeLayer(
        { executable, environment: { DALPH_SECRET_SENTINEL: "credential-must-not-escape" } },
        isolatedCodexProcessNativeService
      ).pipe(Layer.provide(memoryCodexAttemptStoreLayer()))
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        return yield* Effect.exit(action(app))
      }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer), Effect.forkChild)

      yield* awaitFile(fileSystem, `${executable}.received`)
      yield* TestClock.adjust("59 seconds")
      expect(result.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      const exit = yield* Fiber.join(result)
      expect(yield* fileSystem.readFileString(`${executable}.closed`)).toBe("closed\n")
      return exit
    }).pipe(Effect.provide(NodeServices.layer))
  )

const passiveUnansweredFixture = (
  mode: "thread-read-unanswered" | "thread-resume-unanswered" | "background-list-unanswered",
  action: (app: CodexAppServerService) => Effect.Effect<unknown, CodexAppServerFailure>
) =>
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
        const result = yield* Effect.exit(action(app)).pipe(Effect.forkChild)
        yield* awaitFile(fileSystem, `${executable}.received`)
        yield* TestClock.adjust("60 seconds")
        const exit = yield* Fiber.join(result)
        expect(yield* fileSystem.exists(`${executable}.closed`)).toBe(false)
        yield* app.close
        expect(yield* fileSystem.readFileString(`${executable}.closed`)).toBe("closed\n")
        return exit
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
      ["invalid-turn-input-item", "thread/start"],
      ["turn-marker-malformed-user-message", "thread/start"],
      ["turn-marker-contradictory-user-message", "thread/start"],
      ["thread-start-invalid-metadata-token", "thread/start"],
      ["thread-start-invalid-direct-token", "thread/start"],
      ["thread-start-contradictory-tokens", "thread/start"],
      ["duplicate-turn-marker", "thread/start"],
      ["contradictory-turn-token", "thread/start"],
      ["invalid-thread-correlation", "thread/start"],
      ["invalid-thread-correlation-shape", "thread/start"],
      ["invalid-thread-correlation-empty", "thread/start"]
    ] as const,
    ([mode, operation]) =>
      withFixture(mode, (app) =>
        Effect.exit(app.startThread("/fixture/worktree")).pipe(
          Effect.tap((exit) => Effect.sync(() => expectAppFailure(exit, operation)))
        )
      )
  )
)

it.effect("rejects schema-valid envelopes whose nested Codex identity fields are malformed", () =>
  Effect.gen(function* () {
    for (const [mode, operation, detail] of [
      ["turn-marker-malformed-item-discriminator", "thread/start", "turn item discriminator is invalid"],
      ["turn-marker-malformed-content-discriminator", "thread/start", "turn content discriminator is invalid"],
      ["thread-start-missing-status", "thread/start", "thread id, cwd, or status is invalid"],
      ["invalid-turn-token", "thread/start", "thread payload is invalid"],
      ["thread-list-malformed-nested-item", "thread/list", "turn item discriminator is invalid"]
    ] as const) {
      const failure = yield* withFixture(mode, (app) =>
        Effect.gen(function* () {
          if (operation === "thread/list") {
            if (app.listThreads === undefined) return yield* Effect.die("Node app-server did not expose thread/list")
            return yield* app.listThreads().pipe(Effect.flip)
          }
          return yield* app.startThread("/fixture/worktree").pipe(Effect.flip)
        })
      )
      expect(failure).toMatchObject({ kind: "Malformed", operation })
      expect(failure.detail).toContain(detail)
    }
  })
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
  })
)

it.effect("accepts ownership markers only from schema-decoded user-authored input", () =>
  Effect.gen(function* () {
    const owned = yield* withFixture("turn-marker-user-message", (app) =>
      Effect.map(app.startThread("/fixture/worktree"), (thread) => thread.turns[0]?.ownedTurnToken)
    )
    expect(owned).toBe("user-owned")

    for (const mode of [
      "turn-marker-top-level-input-text",
      "turn-marker-assistant-message",
      "turn-marker-provider-prose",
      "turn-marker-non-input-content"
    ] as const) {
      const token = yield* withFixture(mode, (app) =>
        Effect.map(app.startThread("/fixture/worktree"), (thread) => thread.turns[0]?.ownedTurnToken)
      )
      expect(token).toBeUndefined()
    }
  })
)

it.effect("controlled qualification provider serves loopback responses without an OpenAI call", () =>
  withFixture(
    "non-openai-provider-credential",
    (app) => Effect.map(app.startThread("/fixture/worktree"), (thread) => expect(thread.id).toBe("protocol-thread")),
    { environment: { DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL: "fixture-provider-key" } }
  )
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

    const alternateKey = yield* withFixture("thread-list-threads-key", (app) => {
      if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
      return Effect.map(app.listThreads(), (threads) => threads.map((thread) => thread.id))
    })
    expect(alternateKey).toEqual(["protocol-thread"])

    const identicalAliases = yield* withFixture("thread-list-identical-aliases", (app) => {
      if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
      return Effect.map(app.listThreads(), (threads) => threads.map((thread) => thread.id))
    })
    expect(identicalAliases).toEqual(["protocol-thread"])

    for (const mode of [
      "thread-list-not-array",
      "thread-list-invalid-item",
      "thread-list-invalid-fields",
      "thread-list-invalid-status",
      "thread-list-invalid-correlation",
      "thread-list-invalid-token",
      "thread-list-contradictory-values",
      "thread-list-contradictory-cursors",
      "thread-list-missing-values",
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

it.effect("keeps partial thread-list summaries distinct from exact thread snapshots", () =>
  Effect.gen(function* () {
    expectTypeOf<
      Extract<CodexThreadListSummary, { readonly _tag: "CompleteSummary" }>
    >().not.toMatchTypeOf<CodexThreadSnapshot>()
    const summaries = yield* Effect.forEach(
      ["thread-list-identity-only", "thread-list-missing-status", "thread-list-missing-turns", "thread-list-valid"],
      (mode) =>
        withFixture(mode, (app) => {
          if (app.listThreads === undefined) return Effect.fail("Node app-server did not expose thread/list")
          return Effect.map(app.listThreads(), (threads) => threads[0])
        })
    )

    expect(summaries).toEqual([
      { _tag: "IdentityOnly", id: "protocol-thread", cwd: "/fixture/worktree" },
      { _tag: "IncompleteSummary", id: "protocol-thread", cwd: "/fixture/worktree", summary: { turns: [] } },
      { _tag: "IncompleteSummary", id: "protocol-thread", cwd: "/fixture/worktree", summary: { status: "idle" } },
      {
        _tag: "CompleteSummary",
        id: "protocol-thread",
        cwd: "/fixture/worktree",
        summary: { status: "idle", turns: [] }
      }
    ])
  })
)

it.effect("reads every persistent thread-list page before reporting a complete identity list", () =>
  withFixture("thread-list-paginated", (app) =>
    Effect.gen(function* () {
      expect(app.listThreadsComplete).toBe(true)
      if (app.listThreads === undefined) return yield* Effect.fail("Node app-server did not expose thread/list")
      const threads = yield* app.listThreads()
      expect(threads.map((thread) => thread.id)).toEqual(["protocol-thread", "protocol-thread-two"])
      expect(threads.map((thread) => thread._tag)).toEqual(["CompleteSummary", "IdentityOnly"])
    })
  )
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

it.effect("does not retry turn/start when a complete thread census omits turns", () =>
  Effect.forEach(["thread/read", "thread/resume"] as const, (operation) =>
    withFixture("turn-census-omitted", (app, root) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const started = yield* app.startThread(root)
        const read = operation === "thread/read" ? app.readThread(started.id) : app.resumeThread(started.id, root)
        const result = yield* Effect.exit(
          read.pipe(
            Effect.flatMap((thread) =>
              thread.turns.length === 0
                ? app.startTurn(thread.id, root, "retry", CodexOwnedTurnToken.make("retry-token"))
                : Effect.void
            )
          )
        )
        expectAppFailure(result, operation)
        expect(yield* fileSystem.exists(path.join(root, "turn-started"))).toBe(false)
      })
    )
  )
)

it.effect("accepts explicit empty turn censuses from thread/read and thread/resume", () =>
  withFixture("happy", (app) =>
    Effect.gen(function* () {
      const started = yield* app.startThread("/fixture/worktree")
      expect((yield* app.readThread(started.id)).turns).toEqual([])
      expect((yield* app.resumeThread(started.id, "/fixture/worktree")).turns).toEqual([])
    })
  )
)

it.effect("hydrates paginated history with full items from the declared turns operation", () =>
  withFixture("thread-turns-list-hydration", (app) =>
    Effect.gen(function* () {
      const started = yield* app.startThread("/fixture/worktree")
      const read = yield* app.readThread(started.id)
      expect(read.turns[0]?.id).toBe(CodexTurnId.make("protocol-turn-hydrated"))
      expect(read.turns[0]?.status).toBe("completed")
      expect(read.turns[0]?.items).toHaveLength(2)
      expect((yield* app.resumeThread(started.id, "/fixture/worktree")).turns).toEqual(read.turns)
    })
  )
)

it.effect("includes loaded unpersisted threads, exhausts pagination, and deduplicates identities", () =>
  withFixture("loaded-thread-census", (app) =>
    Effect.gen(function* () {
      if (app.listThreads === undefined) return expect.fail("thread census is required")
      const threads = yield* app.listThreads()
      expect(threads.map((thread) => thread.id)).toEqual(["protocol-thread"])
      const first = threads[0]
      if (first === undefined) return expect.fail("loaded thread must be present")
      const thread = yield* app.readThread(first.id)
      expect(thread.ownedThreadToken).toBe("loaded-owned")
    })
  )
)

it.effect("rejects an incomplete loaded census with a repeated cursor", () =>
  withFixture("loaded-thread-repeated-cursor", (app) =>
    Effect.gen(function* () {
      if (app.listThreads === undefined) return expect.fail("thread census is required")
      expectAppFailure(yield* Effect.exit(app.listThreads()), "thread/loaded/list")
    })
  )
)

it.effect("accepts an exact idle unmaterialized-thread proof without inventing a missing rollout", () =>
  withFixture("unmaterialized-thread", (app) =>
    Effect.gen(function* () {
      const started = yield* app.startThread("/fixture/worktree")
      expect((yield* app.readThread(started.id)).turns).toEqual([])
    })
  )
)

it.effect("rejects malformed turn censuses from thread/read and thread/resume", () =>
  Effect.forEach(["thread/read", "thread/resume"] as const, (operation) =>
    withFixture("turn-census-malformed", (app) =>
      Effect.gen(function* () {
        const started = yield* app.startThread("/fixture/worktree")
        const result = yield* Effect.exit(
          operation === "thread/read" ? app.readThread(started.id) : app.resumeThread(started.id, "/fixture/worktree")
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
      ["invalid-jsonrpc-version", "initialize"],
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

it.effect("pins and proves all-yes unattended policy for every task thread and turn", () =>
  withFixture(
    "unattended-policy",
    (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        const turn = yield* app.startTurn(thread.id, "/fixture/worktree", "work")
        expect(turn.id).toBe("protocol-turn")
      }),
    { requireUnattendedPolicy: true }
  )
)

it.effect("fails policy admission before creating a task thread when effective policy is unsupported", () =>
  withFixture(
    "unsupported-unattended-policy",
    (app) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(app.startThread("/fixture/worktree"))
        expectAppFailure(exit, "config/read")
        if (Exit.isFailure(exit)) {
          const failure = Cause.findErrorOption(exit.cause)
          if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
            expect(failure.value.kind).toBe("Protocol")
          }
        }
      }),
    { requireUnattendedPolicy: true }
  )
)

it.effect("turns an unexpected approval request into a sticky provider-protocol failure", () =>
  withFixture("unexpected-approval-request", (app) =>
    Effect.scoped(
      Effect.gen(function* () {
        const hints = yield* app.attachTurnCompletedHints
        const approvalObserved = yield* hints.pipe(Stream.runHead, Effect.forkChild)
        const thread = yield* app.startThread("/fixture/worktree")
        yield* app.startTurn(thread.id, "/fixture/worktree", "work")
        expect(yield* Fiber.join(approvalObserved)).toEqual(Option.some(undefined))
        const exit = yield* Effect.exit(app.readThread(thread.id))
        expectAppFailure(exit, "turn/start")
        if (Exit.isFailure(exit)) {
          const failure = Cause.findErrorOption(exit.cause)
          if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
            expect(failure.value).toMatchObject({ kind: "Protocol", operation: "turn/start" })
            expect(failure.value.detail).toContain("unexpected approval request")
          }
        }
      })
    )
  )
)

it.effect("bounds an unanswered initialize request and closes its exact owned child once", () =>
  Effect.gen(function* () {
    const exit = yield* unansweredFixture("initialize-unanswered", (app) => app.startThread("/fixture/worktree"))
    expectAppFailure(exit, "initialize")
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
        expect(failure.value).toMatchObject({
          kind: "Unavailable",
          rpcSnapshot: { requestId: 1, method: "initialize", sentCount: 1, responseCount: 0, pendingCount: 0 }
        })
        expect(JSON.stringify(failure.value)).not.toMatch(/credential-must-not-escape|DALPH_SECRET_SENTINEL/)
      }
    }
  })
)

it.effect("bounds an unanswered thread start without fabricating a task turn and closes once", () =>
  Effect.gen(function* () {
    const exit = yield* unansweredFixture("thread-start-unanswered", (app) =>
      app.startThread("/fixture/prompt-and-secret-must-not-escape")
    )
    expectAppFailure(exit, "thread/start")
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
        expect(failure.value).toMatchObject({
          kind: "Unavailable",
          rpcSnapshot: { requestId: 2, method: "thread/start", sentCount: 2, responseCount: 1, pendingCount: 0 }
        })
        expect(JSON.stringify(failure.value)).not.toMatch(
          /credential-must-not-escape|DALPH_SECRET_SENTINEL|prompt-and-secret-must-not-escape/
        )
      }
    }
  })
)

it.effect("bounds an unanswered passive retained-thread resume without stopping its owned child", () =>
  Effect.gen(function* () {
    const exit = yield* passiveUnansweredFixture("thread-resume-unanswered", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        return yield* app.resumeThread(thread.id, "/fixture/worktree")
      })
    )
    expectAppFailure(exit, "thread/resume")
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
        expect(failure.value).toMatchObject({
          kind: "ResponseDeadline",
          rpcSnapshot: { requestId: 3, method: "thread/resume", sentCount: 3, responseCount: 2, pendingCount: 0 }
        })
      }
    }
  })
)

it.effect("bounds an unanswered passive retained-thread read without stopping its owned child", () =>
  Effect.gen(function* () {
    const exit = yield* passiveUnansweredFixture("thread-read-unanswered", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        return yield* app.readThread(thread.id)
      })
    )
    expectAppFailure(exit, "thread/read")
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
        expect(failure.value).toMatchObject({
          kind: "ResponseDeadline",
          rpcSnapshot: { requestId: 3, method: "thread/read", sentCount: 3, responseCount: 2, pendingCount: 0 }
        })
      }
    }
  })
)

it.effect("bounds an unanswered passive background terminal census without stopping its owned child", () =>
  Effect.gen(function* () {
    const exit = yield* passiveUnansweredFixture("background-list-unanswered", (app) =>
      Effect.gen(function* () {
        const thread = yield* app.startThread("/fixture/worktree")
        return yield* app.listBackgroundTerminals(thread.id)
      })
    )
    expectAppFailure(exit, "thread/backgroundTerminals/list")
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
        expect(failure.value).toMatchObject({
          kind: "ResponseDeadline",
          rpcSnapshot: {
            requestId: 3,
            method: "thread/backgroundTerminals/list",
            sentCount: 3,
            responseCount: 2,
            pendingCount: 0
          }
        })
      }
    }
  })
)

it.effect("bounds an unanswered turn start and permits one bounded exact-thread read", () =>
  withFixture("turn-start-unanswered-then-read", (app, root) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const thread = yield* app.startThread("/fixture/worktree")
      const token = CodexOwnedTurnToken.make("lost-turn-token")
      const waiting = yield* app
        .startTurn(thread.id, "/fixture/worktree", "prompt-must-not-escape", token)
        .pipe(Effect.exit, Effect.forkChild)
      const executable = path.join(root, "turn-start-unanswered-then-read")
      yield* awaitFile(fileSystem, `${executable}.received`)
      yield* TestClock.adjust("59 seconds")
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      const exit = yield* Fiber.join(waiting)
      expectAppFailure(exit, "turn/start")
      if (Exit.isFailure(exit)) {
        const failure = Cause.findErrorOption(exit.cause)
        if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
          expect(failure.value.rpcSnapshot).toEqual({
            requestId: 3,
            method: "turn/start",
            sentCount: 3,
            responseCount: 2,
            pendingCount: 0
          })
          expect(JSON.stringify(failure.value)).not.toContain("prompt-must-not-escape")
        }
      }
      expect(yield* fileSystem.exists(`${executable}.closed`)).toBe(false)
      const reconciled = yield* app.readThread(thread.id)
      expect(reconciled.turns).toHaveLength(1)
      expect(reconciled.turns[0]?.ownedTurnToken).toBe(token)
      yield* app.close
      expect(yield* fileSystem.readFileString(`${executable}.closed`)).toBe("closed\n")
    })
  )
)

it.effect("does not let an ID-bearing server request settle a colliding outbound request", () =>
  withFixture("server-request-id-collision", (app) =>
    Effect.map(app.startThread("/fixture/worktree"), (thread) => {
      expect(thread.id).toBe("protocol-thread")
      return thread.status
    })
  )
)

it.effect("fails malformed JSON-RPC envelopes through the typed protocol boundary", () =>
  Effect.forEach(
    [
      ["malformed-envelope", "must contain method or id"],
      ["malformed-envelope-method", "method is invalid"],
      ["malformed-envelope-notification-result", "notification cannot contain result or error"],
      ["malformed-envelope-server-result", "server request cannot contain result or error"],
      ["malformed-envelope-server-id", "server request id is invalid"],
      ["malformed-envelope-response-id", "response id is invalid"],
      ["malformed-envelope-response-both", "response must contain exactly one result or error"],
      ["malformed-envelope-response-neither", "response must contain exactly one result or error"],
      ["malformed-envelope-response-error", "response error is invalid"]
    ] as const,
    ([mode, detail]) =>
      withFixture(mode, (app) =>
        Effect.gen(function* () {
          const result = yield* Effect.exit(app.startThread("/fixture/worktree"))
          expectAppFailure(result, "initialize")
          if (Exit.isFailure(result)) {
            const failure = Cause.findErrorOption(result.cause)
            if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
              expect(failure.value).toMatchObject({ kind: "Protocol" })
              expect(failure.value.detail).toContain(detail)
            }
          }
        })
      ),
    { concurrency: 1 }
  )
)

it.effect("keeps an idle malformed JSON-RPC failure sticky before the next request", () =>
  withFixture("idle-malformed-before-next-request", (app, root) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const hints = yield* app.attachTurnCompletedHints
        const malformedObserved = yield* hints.pipe(Stream.runHead, Effect.forkChild)
        const thread = yield* app.startThread("/fixture/worktree")
        expect(thread.id).toBe("protocol-thread")
        expect(yield* Fiber.join(malformedObserved)).toEqual(Option.some(undefined))

        const result = yield* Effect.exit(app.readThread(thread.id))
        expectAppFailure(result, "initialize")
        if (Exit.isFailure(result)) {
          const failure = Cause.findErrorOption(result.cause)
          if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
            expect(failure.value).toMatchObject({ kind: "Protocol", operation: "initialize" })
            expect(failure.value.detail).toContain("must contain method or id")
          }
        }
        expect(yield* fileSystem.readFileString(path.join(root, "idle-malformed-before-next-request.requests"))).toBe(
          "initialize\nthread/start\n"
        )
      })
    )
  )
)

it.effect("rejects an admitted request when malformed protocol state wins before registration", () =>
  Effect.gen(function* () {
    const admissionEntered = yield* Deferred.make<void>()
    const admissionRelease = yield* Deferred.make<void>()
    const requestBoundary: CodexAppServerRequestBoundary = {
      run: (operation, request) =>
        operation === "thread/read"
          ? Deferred.succeed(admissionEntered, undefined).pipe(
              Effect.andThen(Deferred.await(admissionRelease)),
              Effect.andThen(request)
            )
          : request
    }
    return yield* withFixture(
      "malformed-during-admission",
      (app, root) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem
            const path = yield* Path.Path
            const hints = yield* app.attachTurnCompletedHints
            const malformedObserved = yield* hints.pipe(Stream.runHead, Effect.forkChild)
            const thread = yield* app.startThread("/fixture/worktree")
            const request = yield* Effect.exit(app.readThread(thread.id)).pipe(Effect.forkChild)
            yield* Deferred.await(admissionEntered)
            const executable = path.join(root, "malformed-during-admission")
            yield* fileSystem.writeFileString(`${executable}.malformed`, "malformed")
            yield* awaitFile(fileSystem, `${executable}.malformed-sent`)
            expect(yield* Fiber.join(malformedObserved)).toEqual(Option.some(undefined))
            yield* Deferred.succeed(admissionRelease, undefined)
            const result = yield* Fiber.join(request)
            expectAppFailure(result, "thread/read")
            if (Exit.isFailure(result)) {
              const failure = Cause.findErrorOption(result.cause)
              if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
                expect(failure.value.kind).toBe("Protocol")
                expect(failure.value.detail).toContain("must contain method or id")
              }
            }
            expect(yield* fileSystem.readFileString(`${executable}.requests`)).toBe("initialize\nthread/start\n")
          })
        ),
      { requestBoundary }
    )
  })
)

it.effect("fails an already registered request once and refuses a later request", () =>
  withFixture("malformed-after-pending", (app, root) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const thread = yield* app.startThread("/fixture/worktree")
      const request = yield* Effect.exit(app.readThread(thread.id)).pipe(Effect.forkChild)
      const executable = path.join(root, "malformed-after-pending")
      yield* awaitFile(fileSystem, `${executable}.pending`)
      yield* fileSystem.writeFileString(`${executable}.malformed`, "malformed")
      yield* awaitFile(fileSystem, `${executable}.malformed-sent`)
      const firstResult = yield* Fiber.join(request)
      expectAppFailure(firstResult, "thread/read")
      if (Exit.isFailure(firstResult)) {
        const failure = Cause.findErrorOption(firstResult.cause)
        if (Option.isSome(failure) && failure.value instanceof CodexAppServerFailure) {
          expect(failure.value.kind).toBe("Protocol")
        }
      }
      const laterResult = yield* Effect.exit(app.readThread(thread.id))
      expectAppFailure(laterResult, "initialize")
      expect(yield* fileSystem.readFileString(`${executable}.requests`)).toBe("initialize\nthread/start\nthread/read\n")
    })
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

it.effect("keeps existing ID-less completion notifications as wake hints only", () =>
  withFixture("turn-completed-hint", (app) =>
    Effect.scoped(
      Effect.gen(function* () {
        const hints = yield* app.attachTurnCompletedHints
        const received = yield* hints.pipe(Stream.runHead, Effect.forkChild)
        yield* app.startThread("/fixture/worktree")
        expect(yield* Fiber.join(received)).toEqual(Option.some(undefined))
      })
    )
  )
)

it.effect("accepts Codex versionless JSON-RPC-shaped responses and notifications", () =>
  withFixture("versionless-envelope", (app) =>
    Effect.scoped(
      Effect.gen(function* () {
        const hints = yield* app.attachTurnCompletedHints
        const received = yield* hints.pipe(Stream.runHead, Effect.forkChild)
        const thread = yield* app.startThread("/fixture/worktree")
        expect(thread.id).toBe("protocol-thread")
        expect(yield* Fiber.join(received)).toEqual(Option.some(undefined))
      })
    )
  )
)

it.effect("forwards a late item completion as a non-authoritative owned-activity hint", () =>
  withFixture("owned-activity-hint", (app) =>
    Effect.scoped(
      Effect.gen(function* () {
        const hints = yield* app.attachOwnedActivityHints
        const received = yield* hints.pipe(Stream.runHead, Effect.forkChild)
        yield* app.startThread("/fixture/worktree")
        expect(yield* Fiber.join(received)).toEqual(Option.some(undefined))
      })
    )
  )
)

it.effect("coalesces a provider burst while retaining a later terminal wake", () =>
  withFixture("turn-completed-burst", (app) =>
    Effect.scoped(
      Effect.gen(function* () {
        // Subscribe before the current read, then let the provider publish a burst before consumption.
        const hints = yield* app.attachTurnCompletedHints
        const thread = yield* app.startThread("/fixture/worktree")

        expect(yield* Stream.runHead(hints)).toEqual(Option.some(undefined))
        const next = yield* hints.pipe(Stream.runHead, Effect.forkChild)
        yield* Effect.yieldNow
        expect(next.pollUnsafe()).toBeUndefined()

        // Unrelated notifications remain ignored rather than creating a busy loop.
        yield* app.readThread(thread.id)
        yield* Effect.yieldNow
        expect(next.pollUnsafe()).toBeUndefined()

        // A later qualified notification must still wake the attached reader exactly once.
        yield* app.readThread(thread.id)
        expect(yield* Fiber.join(next)).toEqual(Option.some(undefined))
      })
    )
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
    Effect.scoped(
      Effect.gen(function* () {
        const hints = yield* app.attachTurnCompletedHints
        expect(Array.from(yield* Stream.runCollect(hints))).toEqual([])
        const result = yield* Effect.exit(app.startThread("/fixture/worktree"))
        expectAppFailure(result, "initialize")
      })
    )
  )
)

it("selects the node process-native layer when no test-native override is supplied", () => {
  expect(codexAppServerNodeLayer()).toBeDefined()
})
