#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- Executable fixture controls the external Codex process boundary. */
import nodeProcess from "node:process"

let buffer = ""
nodeProcess.stderr.write('DALPH_PUBLIC_RECOVERY_FIXTURE {"_tag":"CodexFixtureStarted"}\n')

const write = (id: unknown, result: unknown) =>
  nodeProcess.stdout.write(`${JSON.stringify({ id, jsonrpc: "2.0", result })}\n`)

const respond = (message: unknown) => {
  if (typeof message !== "object" || message === null) return
  const id = "id" in message ? message.id : undefined
  const method = "method" in message ? message.method : undefined
  if (method === "initialized") return
  if (method === "initialize") {
    write(id, {
      codexHome: nodeProcess.env["CODEX_HOME"] ?? "/tmp",
      platformFamily: "unix",
      platformOs: "linux",
      userAgent: "dalph-public-recovery-qualification"
    })
    return
  }
  if (method === "thread/list" || method === "thread/backgroundTerminals/list") {
    write(id, { data: [] })
    return
  }
  write(id, {})
}

nodeProcess.stdin.setEncoding("utf8")
nodeProcess.stdin.on("data", (chunk: string) => {
  buffer += chunk
  for (;;) {
    const newline = buffer.indexOf("\n")
    if (newline < 0) return
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (line.trim().length > 0) respond(JSON.parse(line))
  }
})
