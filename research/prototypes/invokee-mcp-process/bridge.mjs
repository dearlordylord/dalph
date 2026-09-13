#!/usr/bin/env node
// THROWAWAY: actual stdio MCP child forwarding to an independently owned backend.
import { pathToFileURL } from "node:url"
import { callBackend } from "./http.mjs"
const [sdkRoot, socket] = process.argv.slice(2)
const load = (name) => import(pathToFileURL(`${sdkRoot}/dist/esm/${name}.js`).href)
const [{ Server }, { StdioServerTransport }, types] = await Promise.all([load("server/index"), load("server/stdio"), load("types")])
const server = new Server({ name: "disposable-capacity-bridge", version: "0" }, { capabilities: { tools: {} } })
const emit = (stage) => process.stderr.write(`${JSON.stringify({ stage, pid: process.pid })}\n`)
const untilAborted = (signal, cut) => new Promise((_, reject) => {
  if (signal.aborted) { emit(`bridge-aborted-${cut}`); return reject(new Error("request cancelled")) }
  signal.addEventListener("abort", () => { emit(`bridge-aborted-${cut}`); reject(new Error("request cancelled")) }, { once: true })
})
server.setRequestHandler(types.ListToolsRequestSchema, async () => ({ tools: [
  { name: "state", inputSchema: { type: "object" } },
  { name: "capacity", inputSchema: { type: "object" } }
] }))
server.setRequestHandler(types.CallToolRequestSchema, async (request, extra) => {
  const args = request.params.arguments ?? {}
  if (args.cut === "before-handoff") { emit("bridge-before-handoff"); await untilAborted(extra.signal, args.cut) }
  const result = request.params.name === "state"
    ? await callBackend(socket, "/state", undefined, extra.signal)
    : await callBackend(socket, "/capacity", args, extra.signal)
  if (args.cut === "after-response") { emit("bridge-after-backend-response"); await untilAborted(extra.signal, args.cut) }
  return { content: [{ type: "text", text: JSON.stringify(result) }] }
})
await server.connect(new StdioServerTransport())
