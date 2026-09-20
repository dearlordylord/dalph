import assert from "node:assert/strict"
import { test } from "node:test"
import {
  createFormalProgressLifecycle,
  createFormalProgressReader,
  createFormalProgressWriter,
  formalProgressEventVersion,
  formalProgressHeartbeatMilliseconds,
  renderFormalProgressEvent
} from "./formal-progress-events.mjs"

void test("the opt-in writer emits NDJSON and makes a closed fd non-fatal", () => {
  const writes = []
  const writer = createFormalProgressWriter({ fd: 3, write: (_fd, value) => writes.push(value) })
  assert.equal(writer.emit({ version: formalProgressEventVersion, type: "start", name: "fixture" }), true)
  assert.deepEqual(JSON.parse(writes[0]), { version: 1, type: "start", name: "fixture" })
  const closed = createFormalProgressWriter({
    fd: 3,
    write: () => {
      throw new Error("parent closed")
    }
  })
  assert.equal(closed.emit({ version: 1, type: "heartbeat" }), false)
  assert.equal(closed.emit({ version: 1, type: "heartbeat" }), false)
})

void test("the reader handles split records and leaves malformed transport outside the outcome", () => {
  const events = []
  const diagnostics = []
  const reader = createFormalProgressReader({
    onEvent: (event) => events.push(event),
    onError: (error) => diagnostics.push(error)
  })
  reader.push('{"version":1,"type":"sta')
  reader.push('rt"}\nnot-json\n{"version":1,"type":"terminal"}\n')
  reader.close()
  assert.deepEqual(events, [
    { version: 1, type: "start" },
    { version: 1, type: "terminal" }
  ])
  assert.equal(diagnostics.length, 1)
})

void test("lifecycle identity is semantic while timing, output observation and terminal facts are runner-owned", () => {
  const events = []
  let elapsed = 0
  let wall = 0
  const lifecycle = createFormalProgressLifecycle({
    emit: (event) => events.push(event),
    identity: { position: 7, kind: "sampled-run", name: "fixture model" },
    startedAt: "2026-09-20T00:00:00.000Z",
    startedEpochMilliseconds: 0,
    deadline: "2026-09-20T00:01:00.000Z",
    heartbeatMilliseconds: 0,
    now: () => elapsed,
    clock: () => `2026-09-20T00:00:0${wall}.000Z`
  })
  assert.equal(events[0].type, "start")
  elapsed = 1200
  wall = 1
  lifecycle.observeOutput()
  lifecycle.terminal({ outcome: "exit:0", exitCode: 0, finishedAt: "2026-09-20T00:00:01.200Z" })
  assert.deepEqual(
    events.map(({ type }) => type),
    ["start", "terminal"]
  )
  assert.equal(events[1].position, 7)
  assert.equal(events[1].elapsedMilliseconds, 1200)
  assert.equal(events[1].lastObservedOutputAt, "2026-09-20T00:00:01.000Z")
  assert.match(renderFormalProgressEvent(events[0]), /deadline=2026-09-20T00:01:00.000Z/u)
  assert.match(
    renderFormalProgressEvent({ ...events[0], type: "heartbeat", backendProgress: "unknown" }),
    /backend progress unknown/u
  )
  assert.equal(formalProgressHeartbeatMilliseconds, 15_000)
})

void test("quiet lifecycle emits a heartbeat with unknown backend progress", async () => {
  const events = []
  const lifecycle = createFormalProgressLifecycle({
    emit: (event) => events.push(event),
    identity: { position: 1, kind: "verify", name: "quiet fixture" },
    deadline: "2026-09-20T00:01:00.000Z",
    heartbeatMilliseconds: 10
  })
  await new Promise((resolve) => setTimeout(resolve, 25))
  lifecycle.close()
  assert.ok(events.some((event) => event.type === "heartbeat" && event.backendProgress === "unknown"))
})

void test("the rendered quiet heartbeat includes the complete live-only checkpoint", async () => {
  const events = []
  const lifecycle = createFormalProgressLifecycle({
    emit: (event) => events.push(event),
    identity: { position: 8, kind: "verify", name: "quiet rendered fixture" },
    startedAt: "2026-09-20T00:00:00.000Z",
    startedEpochMilliseconds: 0,
    deadline: "2026-09-20T00:01:00.000Z",
    logPath: "/retained/quiet.log",
    heartbeatMilliseconds: 5,
    now: () => 250,
    clock: () => "2026-09-20T00:00:00.250Z"
  })
  await new Promise((resolve) => setTimeout(resolve, 15))
  lifecycle.close()
  const heartbeat = events.find((event) => event.type === "heartbeat")
  assert.ok(heartbeat)
  assert.deepEqual(
    {
      position: heartbeat.position,
      kind: heartbeat.kind,
      name: heartbeat.name,
      elapsedMilliseconds: heartbeat.elapsedMilliseconds,
      deadline: heartbeat.deadline,
      logPath: heartbeat.logPath,
      lastObservedOutputAt: heartbeat.lastObservedOutputAt,
      backendProgress: heartbeat.backendProgress,
      heartbeatAt: heartbeat.heartbeatAt
    },
    {
      position: 8,
      kind: "verify",
      name: "quiet rendered fixture",
      elapsedMilliseconds: 250,
      deadline: "2026-09-20T00:01:00.000Z",
      logPath: "/retained/quiet.log",
      lastObservedOutputAt: null,
      backendProgress: "unknown",
      heartbeatAt: "2026-09-20T00:00:00.250Z"
    }
  )
  assert.match(renderFormalProgressEvent(heartbeat), /quiet rendered fixture \[8\]/u)
  assert.match(renderFormalProgressEvent(heartbeat), /elapsed=0\.25s/u)
  assert.match(renderFormalProgressEvent(heartbeat), /last observed child output=none/u)
  assert.match(renderFormalProgressEvent(heartbeat), /deadline=2026-09-20T00:01:00\.000Z/u)
  assert.match(renderFormalProgressEvent(heartbeat), /log=\/retained\/quiet\.log/u)
  assert.match(renderFormalProgressEvent(heartbeat), /backend progress unknown/u)
})

void test("a closed progress transport is non-fatal and leaves no active heartbeat", async () => {
  const events = []
  const lifecycle = createFormalProgressLifecycle({
    emit: (event) => {
      events.push(event)
      return false
    },
    identity: { position: 9, kind: "test", name: "closed transport fixture" },
    deadline: "2026-09-20T00:01:00.000Z",
    heartbeatMilliseconds: 5
  })
  assert.equal(lifecycle.open, false)
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.deepEqual(
    events.map((event) => event.type),
    ["start"]
  )
  assert.equal(lifecycle.terminal({ outcome: "exit:0" }), false)
  lifecycle.close()
})

void test("closing an incomplete reader never fabricates a parent-loss terminal", () => {
  const events = []
  const reader = createFormalProgressReader({ onEvent: (event) => events.push(event) })
  reader.push('{"version":1,"type":"start","position":4}\n{"version":1,"type":"heartbeat"}\n')
  reader.close()
  reader.push('{"version":1,"type":"terminal","outcome":"exit:0"}\n')
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "heartbeat"]
  )
})
