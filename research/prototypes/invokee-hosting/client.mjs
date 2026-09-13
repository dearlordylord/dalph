#!/usr/bin/env node

import { request } from "node:http"
import { readFileSync } from "node:fs"

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

const readyPath = options.get("ready")
const command = options.get("command")
if (readyPath === undefined || command === undefined) {
  console.error("usage: client.mjs --ready <path> --command status|watch|capacity")
  process.exit(2)
}

const ready = JSON.parse(readFileSync(readyPath, "utf8"))
const socketPath = ready.socket

const call = (method, path, body) =>
  new Promise((resolve, reject) => {
    const requestOptions = { method, socketPath, path, headers: {} }
    if (body !== undefined) {
      const encoded = JSON.stringify(body)
      requestOptions.headers["content-type"] = "application/json"
      requestOptions.headers["content-length"] = Buffer.byteLength(encoded)
    }
    const outgoing = request(requestOptions, (response) => {
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8")
        try {
          resolve({ status: response.statusCode, body: text.length === 0 ? null : JSON.parse(text) })
        } catch {
          reject(new Error(`invalid response: ${text}`))
        }
      })
    })
    outgoing.once("error", reject)
    if (body !== undefined) outgoing.write(JSON.stringify(body))
    outgoing.end()
  })

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)

try {
  if (command === "status") {
    print(await call("GET", "/status"))
  } else if (command === "capacity") {
    const body = {
      capacity: Number(options.get("capacity")),
      dropResponse: options.get("drop-response") === "true",
      expectedRevision: Number(options.get("expected-revision")),
      runId: options.get("run-id")
    }
    print(await call("POST", "/control/capacity", body))
  } else if (command === "watch") {
    const response = await new Promise((resolve, reject) => {
      const outgoing = request({ method: "GET", socketPath, path: "/events" }, resolve)
      outgoing.once("error", reject)
      outgoing.end()
    })
    let buffer = ""
    let count = 0
    response.setEncoding("utf8")
    response.on("data", (chunk) => {
      buffer += chunk
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (line.length === 0) continue
        print(JSON.parse(line))
        count += 1
        if (count >= Number(options.get("events") ?? "2")) response.destroy()
      }
    })
    await new Promise((resolve, reject) => {
      response.once("close", resolve)
      response.once("error", reject)
    })
  } else {
    throw new Error(`unknown command: ${command}`)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
