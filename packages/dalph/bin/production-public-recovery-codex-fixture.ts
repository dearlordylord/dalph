#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- Executable fixture controls the external Codex process boundary. */
import nodeProcess from "node:process"

let buffer = ""
nodeProcess.stderr.write('DALPH_PUBLIC_RECOVERY_FIXTURE {"_tag":"CodexFixtureStarted"}\n')

const write = (id: unknown, result: unknown) =>
  nodeProcess.stdout.write(`${JSON.stringify({ id, jsonrpc: "2.0", result })}\n`)

interface CodexRequest {
  readonly id: unknown
  readonly method: unknown
}

const codexRequestOf = (message: unknown): CodexRequest | undefined => {
  if (typeof message !== "object" || message === null) return undefined
  return { id: "id" in message ? message.id : undefined, method: "method" in message ? message.method : undefined }
}

const respond = (message: unknown) => {
  const request = codexRequestOf(message)
  if (request === undefined) return
  switch (request.method) {
    case "initialized":
      return
    case "initialize":
      write(request.id, {
        codexHome: nodeProcess.env["CODEX_HOME"] ?? "/tmp",
        platformFamily: "unix",
        platformOs: "linux",
        userAgent: "dalph-public-recovery-qualification"
      })
      return
    case "thread/list":
    case "thread/backgroundTerminals/list":
      write(request.id, { data: [] })
      return
    default:
      write(request.id, {})
  }
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
