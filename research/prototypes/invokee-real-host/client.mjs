#!/usr/bin/env node
// THROWAWAY: separate OS observation client; no host lifecycle commands.
import { get } from "node:http"

const [mode, endpoint] = process.argv.slice(2)
if (!["watch", "snapshot"].includes(mode) || !endpoint) throw new Error("Usage: client.mjs watch|snapshot ENDPOINT")
const url = new URL(mode === "watch" ? "/watch" : "/snapshot", endpoint)
const request = get(url, { agent: false }, (response) => {
  if (response.statusCode !== 200) {
    response.resume()
    throw new Error(`Unexpected response ${response.statusCode}`)
  }
  response.setEncoding("utf8")
  let pending = ""
  response.on("data", (chunk) => {
    pending += chunk
    if (mode === "watch") {
      let boundary
      while ((boundary = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, boundary)
        pending = pending.slice(boundary + 1)
        if (line.trim()) process.stdout.write(`${JSON.stringify(JSON.parse(line))}\n`)
      }
    }
  })
  response.on("end", () => {
    if (mode === "snapshot") process.stdout.write(`${JSON.stringify(JSON.parse(pending))}\n`)
  })
  response.on("error", (error) => { throw error })
})
request.setTimeout(60_000, () => request.destroy(new Error("Observation client timed out")))
request.on("error", (error) => { throw error })
