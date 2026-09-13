#!/usr/bin/env node
// THROWAWAY: independent OS owner of the actual capacity service, no scheduler.
import { createServer } from "node:http"
import { makeDalphCapacity } from "../invokee-hosting/dalph-capacity.mjs"
const socket = process.argv[2]
const runId = "mcp-process-probe"
const control = await makeDalphCapacity(runId)
let heldGate
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const state = async () => ({ runId, policy: await control.read(), records: (await control.records()).length })
const server = createServer(async (req, res) => {
  try {
    let text = ""
    for await (const chunk of req) text += chunk
    const body = text ? JSON.parse(text) : undefined
    let result
    if (req.url === "/state") result = await state()
    else if (req.url === "/release") { heldGate?.resolve(); result = { released: true } }
    else if (req.url === "/capacity") {
      if (body.hold) {
        if (heldGate) throw new Error("only one held call in this probe")
        heldGate = Promise.withResolvers()
        emit({ stage: "backend-received-before-apply" })
        await heldGate.promise
      }
      result = await control.apply({ runId: body.runId, capacity: body.capacity, expectedRevision: body.expectedRevision })
      emit({ stage: "backend-apply-finished", state: await state() })
    } else throw new Error("unknown probe route")
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(result))
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })) }
})
let stopping = false
process.once("SIGTERM", () => {
  if (stopping) return
  stopping = true
  heldGate?.resolve()
  server.close(async () => { await control.close(); process.exit(0) })
  server.closeAllConnections()
})
server.listen(socket, () => emit({ stage: "backend-ready", pid: process.pid }))
