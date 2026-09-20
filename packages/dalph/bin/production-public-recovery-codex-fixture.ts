#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- Executable fixture controls the external Codex process boundary. */
import nodeProcess from "node:process"
import nodeFs from "node:fs"
import nodePath from "node:path"

let buffer = ""
nodeProcess.stderr.write('DALPH_PUBLIC_RECOVERY_FIXTURE {"_tag":"CodexFixtureStarted"}\n')

const write = (id: unknown, result: unknown) =>
  nodeProcess.stdout.write(`${JSON.stringify({ id, jsonrpc: "2.0", result })}\n`)

interface CodexRequest {
  readonly id: unknown
  readonly method: unknown
  readonly params: unknown
}

const codexRequestOf = (message: unknown): CodexRequest | undefined => {
  if (typeof message !== "object" || message === null) return undefined
  return {
    id: "id" in message ? message.id : undefined,
    method: "method" in message ? message.method : undefined,
    params: "params" in message ? message.params : undefined
  }
}

const stateFile = `${nodeProcess.env["DALPH_QUALIFICATION_CLAIM_STATE"] ?? "/tmp/dalph-public-recovery"}.codex`
let thread: Record<string, unknown> = nodeFs.existsSync(stateFile)
  ? JSON.parse(nodeFs.readFileSync(stateFile, "utf8"))
  : { cwd: "/tmp", id: "public-recovery-thread", status: "idle", turns: [] }
const saveThread = () => nodeFs.writeFileSync(stateFile, JSON.stringify(thread))

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
    case "config/read":
      write(request.id, { config: { approval_policy: "never", sandbox_mode: "danger-full-access" } })
      return
    case "thread/start": {
      const params = typeof request.params === "object" && request.params !== null ? request.params : {}
      const metadata =
        "metadata" in params && typeof params.metadata === "object" && params.metadata !== null ? params.metadata : {}
      thread = {
        ...thread,
        cwd: "cwd" in params ? params.cwd : "/tmp",
        status: "idle",
        ...("dalphOwnedThreadToken" in metadata ? { ownedThreadToken: metadata.dalphOwnedThreadToken } : {})
      }
      saveThread()
      write(request.id, { thread })
      return
    }
    case "thread/read":
    case "thread/resume":
      write(request.id, { thread })
      return
    case "turn/start": {
      const params = typeof request.params === "object" && request.params !== null ? request.params : {}
      const input = "input" in params && Array.isArray(params.input) ? params.input : []
      const firstInput = input[0]
      const inputText =
        typeof firstInput === "object" && firstInput !== null && "text" in firstInput
          ? String(firstInput.text)
          : "cancellation fixture"
      const turn = {
        id: "public-recovery-turn",
        items: [{ content: [{ text: inputText, type: "text" }], type: "userMessage" }],
        status: "inProgress"
      }
      thread = { ...thread, status: "active", turns: [turn] }
      saveThread()
      nodeFs.writeFileSync(nodePath.join(String(thread["cwd"]), "cancellation-work-in-progress.txt"), "preserved\n")
      nodeProcess.stderr.write('DALPH_PUBLIC_RECOVERY_FIXTURE {"_tag":"CodexTurnStarted"}\n')
      write(request.id, { turn })
      return
    }
    case "turn/interrupt":
      thread = {
        ...thread,
        status: "idle",
        turns: Array.isArray(thread["turns"])
          ? thread["turns"].map((turn) =>
              typeof turn === "object" && turn !== null ? { ...turn, status: "interrupted" } : turn
            )
          : []
      }
      saveThread()
      write(request.id, {})
      return
    case "thread/list":
      write(request.id, { data: [thread] })
      return
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
