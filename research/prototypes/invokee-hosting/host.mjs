#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname } from "node:path"
import { URL } from "node:url"
import { makeDalphCapacity } from "./dalph-capacity.mjs"

const options = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (!argument.startsWith("--")) continue
  const key = argument.slice(2)
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith("--")) options.set(key, "true")
  else {
    options.set(key, value)
    index += 1
  }
}

const socketPath = options.get("socket")
const readyPath = options.get("ready")
const exitOnClientClose = options.get("exit-on-client-close") === "true"
if (socketPath === undefined || readyPath === undefined) {
  console.error("usage: host.mjs --socket <path> --ready <path>")
  process.exit(2)
}

mkdirSync(dirname(socketPath), { recursive: true })
mkdirSync(dirname(readyPath), { recursive: true })
if (existsSync(socketPath)) unlinkSync(socketPath)
if (existsSync(readyPath)) unlinkSync(readyPath)

const runId = "prototype-run"
const capacityControl = await makeDalphCapacity(runId)
const state = {
  runId,
  graphRevision: 1,
  capacity: 1,
  revision: 1,
  journalRecords: 1,
  ticks: 0,
  tasks: [
    { id: "A", status: "Progressing", progress: 0 },
    { id: "B", status: "Waiting", progress: 0 }
  ]
}

const subscribers = new Set()
let stopping = false

const snapshot = () => ({
  runId: state.runId,
  graphRevision: state.graphRevision,
  capacity: state.capacity,
  revision: state.revision,
  journalRecords: state.journalRecords,
  ticks: state.ticks,
  tasks: state.tasks.map((task) => ({ ...task }))
})

const writeJson = (response, statusCode, body) => {
  response.writeHead(statusCode, { "content-type": "application/json", "cache-control": "no-store" })
  response.end(JSON.stringify(body))
}

const bodyOf = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString("utf8")
  if (body.length === 0) return {}
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

const publish = () => {
  const line = `${JSON.stringify({ _tag: "RunObserved", state: snapshot() })}\n`
  for (const response of subscribers) response.write(line)
}

const closeSubscriber = (response) => {
  subscribers.delete(response)
  response.end()
}

const mirrorPolicy = async (policy) => {
  state.capacity = policy.taskExecutionCapacity
  state.revision = policy.revision
  state.journalRecords = (await capacityControl.records()).length
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://dalph-prototype")
  if (request.method === "GET" && requestUrl.pathname === "/status") {
    await mirrorPolicy(await capacityControl.read())
    writeJson(response, 200, { _tag: "RunStatus", state: snapshot() })
    return
  }
  if (request.method === "GET" && requestUrl.pathname === "/events") {
    response.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" })
    subscribers.add(response)
    response.write(`${JSON.stringify({ _tag: "RunObserved", state: snapshot() })}\n`)
    request.on("close", () => {
      subscribers.delete(response)
      // This mode is a deliberate negative control. A host whose lifetime is
      // accidentally tied to a client must fail the continuing-work check.
      if (exitOnClientClose) stop()
    })
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/control/capacity") {
    const input = await bodyOf(request)
    if (input === null || input.runId !== runId || !Number.isInteger(input.capacity)) {
      writeJson(response, 400, { _tag: "InvalidCapacityRequest" })
      return
    }
    if (input.capacity < 1 || input.capacity > 8) {
      writeJson(response, 400, { _tag: "InvalidCapacityRequest", allowed: [1, 8] })
      return
    }
    const result = await capacityControl.apply({
      capacity: input.capacity,
      expectedRevision: input.expectedRevision,
      runId: input.runId
    })
    if (!result.ok) {
      const error = result.error
      if (error._tag === "TaskWorkCapacityPolicyRevisionConflict") await mirrorPolicy(error.current)
      writeJson(response, 409, {
        _tag: error._tag,
        current: { capacity: error.current?.taskExecutionCapacity, revision: error.current?.revision },
        expectedRevision: input.expectedRevision,
        runId
      })
      return
    }
    await mirrorPolicy(result.policy)
    publish()
    // The caller asks the host to commit, then drops the response. This models
    // an ambiguous transport outcome without retrying the mutation.
    if (input.dropResponse === true) {
      request.socket.destroy()
      return
    }
    writeJson(response, 200, { _tag: "TaskWorkCapacityApplied", state: snapshot() })
    return
  }
  if (request.method === "POST" && requestUrl.pathname === "/shutdown") {
    writeJson(response, 200, { _tag: "HostStopping" })
    stop()
    return
  }
  writeJson(response, 404, { _tag: "NotFound" })
})

const stop = () => {
  if (stopping) return
  stopping = true
  clearInterval(workTimer)
  for (const response of subscribers) closeSubscriber(response)
  server.close(async () => {
    await capacityControl.close()
    try {
      unlinkSync(socketPath)
    } catch {
      // The harness may have removed the disposable socket after a failed start.
    }
    try {
      unlinkSync(readyPath)
    } catch {
      // The ready marker is disposable evidence for this one host process.
    }
    process.exit(0)
  })
}

process.once("SIGTERM", stop)
process.once("SIGINT", stop)

const workTimer = setInterval(() => {
  if (stopping) return
  state.ticks += 1
  const active = state.tasks.find((task) => task.status === "Progressing")
  if (active !== undefined) {
    active.progress += 1
  }
  publish()
}, 100)

server.listen(socketPath, () => {
  writeFileSync(readyPath, JSON.stringify({ socket: socketPath, runId, pid: process.pid }))
  process.stdout.write(`${JSON.stringify({ _tag: "HostReady", runId, pid: process.pid })}\n`)
})
