#!/usr/bin/env node
// THROWAWAY: separate OS graph-stream client; no host lifecycle commands.
import { get } from "node:http"

const [endpoint] = process.argv.slice(2)
if (!endpoint) throw new Error("Usage: client.mjs ENDPOINT")
const request = get(new URL("/watch", endpoint), { agent: false }, (response) => {
  if (response.statusCode !== 200) {
    response.resume()
    throw new Error(`Unexpected response ${response.statusCode}`)
  }
  response.setEncoding("utf8")
  let pending = ""
  response.on("data", (chunk) => {
    pending += chunk
    let boundary
    while ((boundary = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, boundary)
      pending = pending.slice(boundary + 1)
      if (line.trim()) process.stdout.write(`${JSON.stringify(JSON.parse(line))}\n`)
    }
  })
  response.on("error", (error) => { throw error })
})
request.setTimeout(90_000, () => request.destroy(new Error("Graph stream client timed out")))
request.on("error", (error) => { throw error })
