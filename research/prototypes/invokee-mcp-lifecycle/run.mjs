#!/usr/bin/env node
// THROWAWAY: real SDK request cancellation; no Dalph or external worker.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const sdkRoot = resolve(process.argv[2] ?? "/workspace/typescript/dnd/node_modules/@modelcontextprotocol/sdk")
const moduleAt = (name) => import(pathToFileURL(`${sdkRoot}/dist/esm/${name}.js`).href)
const [{ Client }, { Server }, { InMemoryTransport }, types] = await Promise.all([
  moduleAt("client/index"), moduleAt("server/index"), moduleAt("inMemory"), moduleAt("types")
])
const { version } = JSON.parse(await readFile(`${sdkRoot}/package.json`, "utf8"))

const observations = []
for (const mode of ["cancel-request", "close-connection"]) {
  const client = new Client({ name: "throwaway-client", version: "0" })
  const server = new Server({ name: "throwaway-server", version: "0" }, { capabilities: { tools: {} } })
  const entered = Promise.withResolvers()
  const aborted = Promise.withResolvers()
  server.setRequestHandler(types.CallToolRequestSchema, async (_request, extra) => {
    assert.equal(extra.signal.aborted, false)
    extra.signal.addEventListener("abort", () => aborted.resolve(true), { once: true })
    entered.resolve()
    await aborted.promise
    return { content: [{ type: "text", text: "handler observed abort" }] }
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const watchdog = setTimeout(() => { throw new Error(`Probe stalled: ${mode}`) }, 5000)
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const controller = new AbortController()
    const result = client.request(
      { method: "tools/call", params: { name: "held", arguments: {} } },
      types.CallToolResultSchema,
      { signal: controller.signal }
    ).then(() => ({ rejected: false }), () => ({ rejected: true }))
    await entered.promise
    if (mode === "cancel-request") controller.abort(new Error("controlled cancellation"))
    else await client.close()
    assert.equal(await aborted.promise, true)
    assert.equal((await result).rejected, true)
    observations.push({ mode, handlerStartedBeforeTrigger: true, handlerSignalAborted: true, clientRequestRejected: true })
  } finally {
    clearTimeout(watchdog)
    await client.close()
    await server.close()
  }
}
console.log(JSON.stringify({ sdkVersion: version, transport: "in-memory", observations }, null, 2))
