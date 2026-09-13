// THROWAWAY: installed MCP SDK client and real stdio server child lifecycle.
import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const here = dirname(fileURLToPath(import.meta.url))
const sdkRoot = "/workspace/typescript/dnd/node_modules/@modelcontextprotocol/sdk"
const load = (name) => import(pathToFileURL(`${sdkRoot}/dist/esm/${name}.js`).href)
const [{ Client }, { StdioClientTransport }, types] = await Promise.all([load("client/index"), load("client/stdio"), load("types")])
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
const sessions = []
export const connect = async (socket) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(here, "../invokee-mcp-process/bridge.mjs"), sdkRoot, socket], stderr: "pipe" })
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
export const close = async (session) => {
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
export const call = (session, name, args = {}, signal) => session.client.request(
  { method: "tools/call", params: { name, arguments: args } }, types.CallToolResultSchema,
  signal === undefined ? {} : { signal }
).then((result) => JSON.parse(result.content[0].text))

export const closeAll = async () => {
 const results = await Promise.allSettled(sessions.map(close))
 const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason)
 if (errors.length) throw new AggregateError(errors, "MCP cleanup")
}
