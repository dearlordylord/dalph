#!/usr/bin/env node
// THROWAWAY: real SDK stdio processes + independently owned real capacity service.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { callBackend } from "./http.mjs"
const here = dirname(fileURLToPath(import.meta.url))
const sdkRoot = resolve(process.argv[2] ?? "/workspace/typescript/dnd/node_modules/@modelcontextprotocol/sdk")
const load = (name) => import(pathToFileURL(`${sdkRoot}/dist/esm/${name}.js`).href)
const [{ Client }, { StdioClientTransport }, types] = await Promise.all([load("client/index"), load("client/stdio"), load("types")])
const { version: sdkVersion } = JSON.parse(await readFile(`${sdkRoot}/package.json`, "utf8"))
const root = await mkdtemp(join(tmpdir(), "dalph-mcp-process-"))
const socket = join(root, "capacity.sock")
const bounded = async (promise, milliseconds, label) => {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds) })]) }
  finally { clearTimeout(timer) }
}
const eventsOf = (stream) => {
  let pending = ""
  const events = []
  const waiters = new Set()
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    pending += chunk
    let end
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end)
      pending = pending.slice(end + 1)
      let event
      try { event = JSON.parse(line) } catch { event = { diagnostic: line } }
      events.push(event)
      for (const waiter of waiters) if (waiter.predicate(event)) { waiter.resolve(event); waiters.delete(waiter) }
    }
  })
  return { wait: (predicate) => {
    const found = events.find(predicate)
    if (found) return Promise.resolve(found)
    let waiter
    return bounded(new Promise((resolve) => { waiter = { predicate, resolve }; waiters.add(waiter) }), 20_000, "stage marker timed out").catch((error) => { throw new Error(`${error.message}: ${predicate}; observed ${JSON.stringify(events)}`) }).finally(() => waiters.delete(waiter))
  } }
}
const backend = spawn(process.execPath, [join(here, "backend.mjs"), socket], { stdio: ["ignore", "pipe", "pipe"] })
const backendEvents = eventsOf(backend.stdout)
let backendError = ""
backend.stderr.setEncoding("utf8").on("data", (chunk) => { backendError += chunk })
const backendExit = new Promise((resolve, reject) => {
  backend.once("error", reject)
  backend.once("exit", (code, signal) => resolve({ code, signal }))
})
const sessions = []
const connect = async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(here, "bridge.mjs"), sdkRoot, socket], stderr: "pipe" })
  const events = eventsOf(transport.stderr)
  const client = new Client({ name: "disposable-orchestrator", version: "0" })
  const closed = Promise.withResolvers()
  const session = { client, transport, events, closed, pid: null, exitVerified: false, closedObserved: false }
  client.onclose = () => { session.closedObserved = true; closed.resolve() }
  sessions.push(session)
  await client.connect(transport)
  session.pid = transport.pid
  assert.ok(session.pid)
  const tools = await client.listTools()
  assert.deepEqual(tools.tools.map((tool) => tool.name), ["state", "capacity"])
  return session
}
const close = async (session) => {
  if (session.exitVerified) return
  const pid = session.pid ?? session.transport.pid
  try {
    await bounded(session.client.close(), 6000, "MCP close timed out")
    await bounded(session.closed.promise, 2000, "MCP child close event missing")
  } catch (error) {
    if (!session.closedObserved && pid !== null) {
      try { process.kill(pid, "SIGKILL") } catch (killError) { if (killError.code !== "ESRCH") throw killError }
      await bounded(session.closed.promise, 5000, "MCP child survived kill fallback")
    } else throw error
  }
  if (pid !== null) assert.throws(() => process.kill(pid, 0), (error) => error.code === "ESRCH")
  session.exitVerified = true
}
const call = (session, name, args = {}, signal) => session.client.request(
  { method: "tools/call", params: { name, arguments: args } }, types.CallToolResultSchema,
  signal === undefined ? {} : { signal }
).then((result) => JSON.parse(result.content[0].text))
const cancelled = (promise) => promise.then(() => ({ rejected: false }), () => ({ rejected: true }))
const run = async () => {
  await Promise.race([
    backendEvents.wait((event) => event.stage === "backend-ready"),
    backendExit.then((exit) => { throw new Error(`backend early exit ${JSON.stringify(exit)} ${backendError}`) })
  ])
  const first = await connect()
  const initial = await call(first, "state")
  const exact = { runId: initial.runId, capacity: 2, expectedRevision: initial.policy.revision }
  const beforeAbort = new AbortController()
  const before = cancelled(call(first, "capacity", { ...exact, cut: "before-handoff" }, beforeAbort.signal))
  await first.events.wait((event) => event.stage === "bridge-before-handoff")
  beforeAbort.abort(new Error("controlled pre-handoff cancellation"))
  assert.equal((await before).rejected, true)
  const beforeAbortEvent = await first.events.wait((event) => event.stage === "bridge-aborted-before-handoff")
  const afterBefore = await call(first, "state")
  assert.equal(afterBefore.records, 1)
  assert.equal(afterBefore.policy.revision, 1)

  const pending = cancelled(call(first, "capacity", { ...exact, hold: true }))
  await backendEvents.wait((event) => event.stage === "backend-received-before-apply")
  assert.equal((await callBackend(socket, "/state")).records, 1)
  await close(first)
  assert.equal((await pending).rejected, true)
  assert.equal(backend.exitCode, null)
  assert.equal(backend.signalCode, null)
  assert.equal((await callBackend(socket, "/state")).records, 1)
  await callBackend(socket, "/release", {})
  await backendEvents.wait((event) => event.stage === "backend-apply-finished" && event.state.policy.revision === 2)
  const second = await connect()
  const afterReconnect = await call(second, "state")
  assert.equal(afterReconnect.runId, initial.runId)
  assert.equal(afterReconnect.policy.taskExecutionCapacity, 2)
  assert.equal(afterReconnect.policy.revision, 2)
  assert.equal(afterReconnect.records, 2)

  const next = { runId: initial.runId, capacity: 3, expectedRevision: 2 }
  const afterAbort = new AbortController()
  const after = cancelled(call(second, "capacity", { ...next, cut: "after-response" }, afterAbort.signal))
  await second.events.wait((event) => event.stage === "bridge-after-backend-response")
  afterAbort.abort(new Error("controlled post-ack cancellation"))
  assert.equal((await after).rejected, true)
  const afterAbortEvent = await second.events.wait((event) => event.stage === "bridge-aborted-after-response")
  await close(second)
  const third = await connect()
  const observed = await call(third, "state")
  assert.equal(observed.policy.taskExecutionCapacity, 3)
  assert.equal(observed.policy.revision, 3)
  assert.equal(observed.records, 3)
  const replay = await call(third, "capacity", next)
  assert.equal(replay.ok, false)
  assert.equal(replay.error._tag, "TaskWorkCapacityPolicyRevisionConflict")
  assert.equal((await call(third, "state")).records, 3)
  await close(third)
  const backendProcessSurvived = backend.exitCode === null && backend.signalCode === null
  assert.equal(backendProcessSurvived, true)
  return { sdkVersion, mcpChildProcesses: sessions.length, backendProcessSurvived,
    preHandoffCancellation: { records: afterBefore.records, revision: afterBefore.policy.revision },
    afterChildExitAndGateRelease: { records: afterReconnect.records, revision: afterReconnect.policy.revision },
    postAcknowledgementCancellation: { records: observed.records, revision: observed.policy.revision },
    exactReplay: replay.error._tag, sameRun: afterReconnect.runId === initial.runId, childExitsVerified: sessions.every((session) => session.exitVerified), serverAbortSignalsObserved: [beforeAbortEvent, afterAbortEvent].filter((event) => event.stage.startsWith("bridge-aborted-")).length }
}
let watchdog
try {
  const result = await Promise.race([run(), new Promise((_, reject) => {
    watchdog = setTimeout(() => reject(new Error(`MCP process probe timed out: ${backendError}`)), 60_000)
  })])
  console.log(JSON.stringify(result, null, 2))
} finally {
  clearTimeout(watchdog)
  const cleanup = await Promise.allSettled(sessions.map(close))
  backend.kill("SIGTERM")
  const killTimer = setTimeout(() => backend.kill("SIGKILL"), 5000)
  try { await backendExit } finally { clearTimeout(killTimer); await rm(root, { recursive: true, force: true }) }
  const cleanupErrors = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason)
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "MCP child cleanup failed")
}
