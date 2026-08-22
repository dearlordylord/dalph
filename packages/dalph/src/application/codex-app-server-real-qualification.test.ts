/* eslint-disable import/no-nodejs-modules -- The qualification owns real local HTTP, Git, and OS process boundaries. */
/* eslint-disable functional/immutable-data -- The fixture records disposable observations in local test state. */
/* eslint-disable functional/no-mixed-types -- The host adapter intentionally combines process observations and operations. */
/* eslint-disable functional/no-throw-statements -- Boundary failures must fail the qualification fixture immediately. */
/* eslint-disable no-restricted-globals -- The explicit opt-in is read before live tests are registered. */

import { execFile as nodeExecFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import type { Socket } from "node:net"
import { tmpdir } from "node:os"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"

const execFile = promisify(nodeExecFile)
const qualificationEnabled = nodeProcess.env["DALPH_RUN_REAL_CODEX_QUALIFICATION"] === "1"
const codexExecutable = nodeProcess.env["CODEX_BIN"] ?? "codex"
const host = nodeProcess.platform === "linux" ? "linux" : nodeProcess.platform === "darwin" ? "macos" : "unsupported"

type SupportedHost = "linux" | "macos"
type QualificationMode = "accepted" | "failed" | "holding"

/** The one host-specific observation adapter used by every real chronology. */
interface HostProcessObservationAdapter {
  readonly host: SupportedHost
  readonly signalGroup: (pid: number, signal: NodeJS.Signals) => void
  readonly isLive: (pid: number) => boolean
  readonly waitAbsent: (pid: number) => Promise<void>
  readonly waitGroupAbsent: (processGroupId: number) => Promise<void>
}

const processObservationFor = (): HostProcessObservationAdapter => {
  if (host !== "linux" && host !== "macos") {
    throw new Error(`Codex qualification supports Linux and macOS only; got ${nodeProcess.platform}`)
  }
  const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
    try {
      nodeProcess.kill(-pid, signal)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("ESRCH")) throw error
    }
  }
  const isLive = (pid: number): boolean => {
    try {
      nodeProcess.kill(pid, 0)
      return true
    } catch (error) {
      if (error instanceof Error && error.message.includes("EPERM")) return true
      return false
    }
  }
  const waitAbsent = async (pid: number): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!isLive(pid)) return
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`${host} app-server process ${pid} remained live after group termination`)
  }
  const waitGroupAbsent = async (processGroupId: number): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { stdout } = await execFile("ps", ["-axo", "pid=,pgid="])
      const members = stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => /^(?:\s*)(\d+)\s+(\d+)(?:\s*)$/.exec(line))
      const malformedIndex = members.findIndex((member) => member === null)
      if (malformedIndex >= 0) throw new Error(`${host} process-group census row ${malformedIndex + 1} is malformed`)
      if (!members.some((member) => Number(member?.[2]) === processGroupId)) return
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`${host} app-server process group ${processGroupId} remained live after group termination`)
  }
  return { host, signalGroup, isLive, waitAbsent, waitGroupAbsent }
}

const supportedHost = host === "linux" || host === "macos"

const jsonLine = (value: unknown): string => `${JSON.stringify(value)}\n`

const sseEvent = (value: Record<string, unknown>): string => `data: ${JSON.stringify(value)}\n\n`

const defaultUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 }

const responseCreated = (id: string): Record<string, unknown> => ({ type: "response.created", response: { id } })

const responseCompleted = (id: string): Record<string, unknown> => ({
  type: "response.completed",
  response: { id, usage: defaultUsage }
})

const responseFailed = (id: string): Record<string, unknown> => ({
  type: "response.failed",
  response: { id, status: "failed", error: { code: "fixture_failure", message: "controlled failure" } }
})

const responseAssistantMessage = (message: string): Record<string, unknown> => ({
  type: "response.output_item.done",
  item: {
    type: "message",
    role: "assistant",
    id: "fixture-assistant-message",
    content: [{ type: "output_text", text: message }]
  }
})

const responseShellCommand = (worktree: string): Record<string, unknown> => ({
  type: "response.output_item.done",
  item: {
    type: "function_call",
    call_id: "fixture-shell-command",
    name: "shell_command",
    arguments: JSON.stringify({
      command:
        "printf '%s\\n' real-codex-qualification > dalph-real-codex.txt && git add dalph-real-codex.txt && git commit -m dalph-real-codex-qualification >/dev/null && git rev-parse HEAD",
      workdir: worktree,
      timeout_ms: 10_000
    })
  }
})

const commitFromModelRequest = (body: string): string => {
  const commits = body.match(/\b[0-9a-f]{40}\b/g) ?? []
  return commits.at(-1) ?? "0".repeat(40)
}

const correlationFromModelRequest = (body: string): { readonly runId: string; readonly attemptId: string } => ({
  runId: body.match(/run_id:\s*([^\s\\"]+)/)?.[1] ?? "qualification-run",
  attemptId: body.match(/attempt_id:\s*([^\s\\"]+)/)?.[1] ?? "qualification-attempt"
})

/** A deterministic local Responses API server; it never contacts OpenAI. */
class LocalResponsesFixture {
  readonly calls: Array<string> = []
  readonly sockets = new Set<Socket>()
  private readonly server: Server
  private readonly mode: QualificationMode
  private readonly worktree: string
  private closed = false

  constructor(mode: QualificationMode, worktree: string) {
    this.mode = mode
    this.worktree = worktree
    this.server = createServer((request, response) => this.handle(request, response))
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", () => resolve())
    })
    const address = this.server.address()
    if (address === null || typeof address === "string") throw new Error("fixture endpoint did not bind a TCP port")
    return `http://127.0.0.1:${address.port}/v1`
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error === undefined ? resolve() : reject(error)))
    )
  }

  async waitForCalls(count: number, timeoutMilliseconds = 10_000): Promise<void> {
    const attempts = Math.ceil(timeoutMilliseconds / 10)
    for (let attempt = 0; this.calls.length < count && attempt < attempts; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
    if (this.calls.length < count) throw new Error(`timed out waiting for ${count} fixture model calls`)
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.sockets.add(request.socket)
    request.socket.once("close", () => this.sockets.delete(request.socket))
    if (request.method !== "POST" || request.url?.split("?", 1)[0] !== "/v1/responses") {
      response.writeHead(404).end()
      return
    }
    const body = await this.readBody(request)
    this.calls.push(body)
    response.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "keep-alive",
      "cache-control": "no-cache"
    })
    const responseId = `fixture-response-${this.calls.length}`
    response.write(sseEvent(responseCreated(responseId)))
    if (this.mode === "holding") return
    if (this.mode === "failed") {
      response.write(sseEvent(responseFailed(responseId)))
      response.end()
      return
    }
    if (this.calls.length === 1) {
      response.write(sseEvent(responseShellCommand(this.worktree)))
      response.write(sseEvent(responseCompleted(responseId)))
      response.end()
      return
    }
    const correlation = correlationFromModelRequest(body)
    const commit = commitFromModelRequest(body)
    response.write(sseEvent(responseAssistantMessage(JSON.stringify({ commit, correlation }))))
    response.write(sseEvent(responseCompleted(responseId)))
    response.end()
  }

  private async readBody(request: IncomingMessage): Promise<string> {
    const chunks: Array<Buffer> = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString("utf8")
  }
}

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown)
const RpcMessage = Schema.Struct({
  id: Schema.optionalKey(Schema.Int),
  method: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(UnknownRecord),
  error: Schema.optionalKey(UnknownRecord),
  params: Schema.optionalKey(UnknownRecord)
})
type RpcMessage = typeof RpcMessage.Type

const IdentifiedProtocolValue = Schema.Struct({ id: Schema.String })

class JsonRpcFixtureClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: RpcMessage) => void; reject: (error: Error) => void }>()
  private readonly notifications: Array<RpcMessage> = []
  private readonly notificationWaiters = new Map<
    string,
    Array<{ readonly resolve: (value: RpcMessage) => void; readonly timeout: ReturnType<typeof setTimeout> }>
  >()
  private buffer = ""

  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.consume(chunk))
    child.on("exit", (code, signal) => {
      const error = new Error(`Codex app-server exited (${String(code)} ${String(signal)})`)
      for (const waiter of this.pending.values()) waiter.reject(error)
      this.pending.clear()
    })
  }

  request(method: string, params: Record<string, unknown>): Promise<RpcMessage> {
    const id = this.nextId++
    const message = { jsonrpc: "2.0", id, method, params }
    this.child.stdin.write(jsonLine(message))
    return new Promise<RpcMessage>((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.child.stdin.write(jsonLine({ jsonrpc: "2.0", method, params }))
  }

  waitForNotification(method: string, timeoutMilliseconds = 10_000): Promise<RpcMessage> {
    const existing = this.notifications.find((notification) => notification.method === method)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise<RpcMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const current = this.notificationWaiters.get(method) ?? []
        this.notificationWaiters.set(
          method,
          current.filter((waiter) => waiter.resolve !== resolve)
        )
        reject(new Error(`timed out waiting for Codex ${method}`))
      }, timeoutMilliseconds)
      const current = this.notificationWaiters.get(method) ?? []
      this.notificationWaiters.set(method, [...current, { resolve, timeout }])
    })
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return
    this.child.stdin.end()
    await new Promise<void>((resolve) => this.child.once("exit", () => resolve()))
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    let lineEnd = this.buffer.indexOf("\n")
    while (lineEnd >= 0) {
      const line = this.buffer.slice(0, lineEnd).trim()
      this.buffer = this.buffer.slice(lineEnd + 1)
      if (line.length > 0) {
        const message = Schema.decodeUnknownSync(RpcMessage)(JSON.parse(line))
        if (message.id === undefined) {
          this.notifications.push(message)
          if (message.method !== undefined) {
            const waiters = this.notificationWaiters.get(message.method) ?? []
            this.notificationWaiters.delete(message.method)
            for (const waiter of waiters) {
              clearTimeout(waiter.timeout)
              waiter.resolve(message)
            }
          }
        } else {
          const waiter = this.pending.get(message.id)
          if (waiter !== undefined) {
            this.pending.delete(message.id)
            if (message.error === undefined) waiter.resolve(message)
            else waiter.reject(new Error(JSON.stringify(message.error)))
          }
        }
      }
      lineEnd = this.buffer.indexOf("\n")
    }
  }
}

interface GitFixture {
  readonly root: string
  readonly repository: string
  readonly worktree: string
  readonly baseSha: string
  readonly codexHome: string
  readonly model: LocalResponsesFixture
}

interface RunningFixture extends GitFixture {
  readonly child: ChildProcessWithoutNullStreams
  readonly rpc: JsonRpcFixtureClient
  readonly threadId: string
}

const runGit = async (cwd: string, ...args: ReadonlyArray<string>): Promise<string> => {
  const result = await execFile("git", ["-C", cwd, ...args], { encoding: "utf8" })
  return result.stdout.trim()
}

const createGitFixture = async (mode: QualificationMode): Promise<GitFixture> => {
  const root = await mkdtemp(nodePath.join(tmpdir(), "dalph-real-codex-qualification-"))
  const repository = nodePath.join(root, "repository")
  const worktree = nodePath.join(root, "planned-worktree")
  const codexHome = nodePath.join(root, "codex-home")
  await mkdir(repository)
  await mkdir(codexHome)
  await execFile("git", ["init", "--initial-branch=main", repository])
  await runGit(repository, "config", "user.email", "dalph@example.invalid")
  await runGit(repository, "config", "user.name", "Dalph real Codex qualification")
  await writeFile(nodePath.join(repository, "README.md"), "real Codex qualification base\n")
  await runGit(repository, "add", "README.md")
  await runGit(repository, "commit", "-m", "fixture base")
  const baseSha = await runGit(repository, "rev-parse", "HEAD")
  await execFile("git", [
    "-C",
    repository,
    "worktree",
    "add",
    "-b",
    "dalph/real-codex-qualification",
    worktree,
    baseSha
  ])
  const model = new LocalResponsesFixture(mode, worktree)
  const endpoint = await model.start()
  const config = [
    'model = "fixture-model"',
    'model_provider = "fixture"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "",
    "[model_providers.fixture]",
    'name = "Dalph deterministic qualification fixture"',
    `base_url = "${endpoint}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    "request_max_retries = 0",
    "stream_max_retries = 0",
    "",
    `[projects."${worktree}"]`,
    'trust_level = "trusted"',
    ""
  ].join("\n")
  await writeFile(nodePath.join(codexHome, "config.toml"), config)
  return { root, repository, worktree, baseSha, codexHome, model }
}

const launchCodex = async (
  fixture: GitFixture
): Promise<{
  readonly child: ChildProcessWithoutNullStreams
  readonly rpc: JsonRpcFixtureClient
  readonly threadId: string
}> => {
  const launched = await launchCodexProcess(fixture)
  const started = await launched.rpc.request("thread/start", { cwd: fixture.worktree, ephemeral: false })
  const thread = Schema.decodeUnknownSync(IdentifiedProtocolValue)(started.result?.["thread"])
  return { ...launched, threadId: thread.id }
}

const launchCodexProcess = async (
  fixture: GitFixture
): Promise<{ readonly child: ChildProcessWithoutNullStreams; readonly rpc: JsonRpcFixtureClient }> => {
  const child = spawn(codexExecutable, ["app-server", "--stdio"], {
    cwd: fixture.worktree,
    detached: true,
    env: { ...nodeProcess.env, CODEX_HOME: fixture.codexHome, OPENAI_API_KEY: "dalph-deterministic-fixture" },
    stdio: ["pipe", "pipe", "pipe"]
  })
  const rpc = new JsonRpcFixtureClient(child)
  await rpc.request("initialize", { clientInfo: { name: "dalph-real-qualification", version: "0.0.0" } })
  rpc.notify("initialized", {})
  return { child, rpc }
}

const cleanupFixture = async (fixture: GitFixture, child?: ChildProcessWithoutNullStreams): Promise<void> => {
  let cleanupFailure: unknown
  if (child !== undefined) {
    const pid = processId(child)
    try {
      processObservationFor().signalGroup(pid, "SIGTERM")
      await processObservationFor().waitGroupAbsent(pid)
    } catch (error) {
      try {
        processObservationFor().signalGroup(pid, "SIGKILL")
        await processObservationFor().waitGroupAbsent(pid)
      } catch (forceError) {
        cleanupFailure = new AggregateError([error, forceError], `cannot prove fixture process group ${pid} absent`)
      }
    }
  }
  await fixture.model.close()
  if (cleanupFailure !== undefined) throw cleanupFailure
  await rm(fixture.root, { recursive: true, force: true })
}

const processId = (child: ChildProcessWithoutNullStreams): number => {
  if (child.pid === undefined) throw new Error("Codex app-server child did not expose a process id")
  return child.pid
}

const runTurn = async (running: RunningFixture, text: string): Promise<RpcMessage> => {
  const response = await running.rpc.request("turn/start", {
    threadId: running.threadId,
    cwd: running.worktree,
    input: [{ type: "text", text }]
  })
  return response
}

const runningFixture = async (mode: QualificationMode): Promise<RunningFixture> => {
  const fixture = await createGitFixture(mode)
  const launched = await launchCodex(fixture)
  return { ...fixture, ...launched }
}

const qualificationTest = (name: string, test: () => Promise<void>): void => {
  it.skipIf(!qualificationEnabled || !supportedHost)(name, test, 120_000)
}

describe("#75 real built Codex app-server qualification", () => {
  qualificationTest(
    "create and materialize: one real thread stores one task turn in the registered worktree",
    async () => {
      const fixture = await runningFixture("accepted")
      try {
        const response = await runTurn(
          { ...fixture, threadId: fixture.threadId },
          "run_id: qualification-run attempt_id: qualification-attempt create and materialize"
        )
        expect(response.result?.["turn"]).toMatchObject({ status: "inProgress" })
        await fixture.rpc.waitForNotification("turn/completed")
        const read = await fixture.rpc.request("thread/read", { threadId: fixture.threadId, includeTurns: true })
        expect(read.result?.["thread"]).toMatchObject({ id: fixture.threadId, cwd: fixture.worktree })
        expect(fixture.model.calls).toHaveLength(2)
        expect(await runGit(fixture.worktree, "rev-parse", "HEAD")).not.toBe(fixture.baseSha)
        expect(await runGit(fixture.worktree, "show", "HEAD:dalph-real-codex.txt")).toBe("real-codex-qualification")
      } finally {
        await cleanupFixture(fixture, fixture.child)
      }
    }
  )

  qualificationTest(
    "empty pre-turn loss: a killed empty process sends no model request before one later turn",
    async () => {
      const fixture = await createGitFixture("accepted")
      const first = await launchCodex(fixture)
      const observation = processObservationFor()
      try {
        observation.signalGroup(processId(first.child), "SIGKILL")
        await observation.waitAbsent(processId(first.child))
        expect(fixture.model.calls).toHaveLength(0)
        const second = await launchCodex(fixture)
        try {
          await runTurn(
            { ...fixture, ...second, threadId: second.threadId },
            "run_id: qualification-run attempt_id: qualification-attempt empty pre-turn retry"
          )
          await fixture.model.waitForCalls(2)
          await second.rpc.waitForNotification("turn/completed")
          expect(fixture.model.calls).toHaveLength(2)
        } finally {
          await cleanupFixture(fixture, second.child)
        }
      } finally {
        await cleanupFixture(fixture, first.child)
      }
    }
  )

  qualificationTest(
    "turn-response loss: process death after turn admission reads the same thread and sends no duplicate turn",
    async () => {
      const fixture = await runningFixture("holding")
      const observation = processObservationFor()
      try {
        await runTurn(
          { ...fixture, threadId: fixture.threadId },
          "run_id: qualification-run attempt_id: qualification-attempt turn loss"
        )
        await fixture.model.waitForCalls(1)
        observation.signalGroup(processId(fixture.child), "SIGKILL")
        await observation.waitAbsent(processId(fixture.child))
        expect(fixture.model.calls).toHaveLength(1)
        const replacement = await launchCodex(fixture)
        try {
          const read = await replacement.rpc.request("thread/read", { threadId: fixture.threadId, includeTurns: true })
          expect(read.result?.["thread"]).toMatchObject({ id: fixture.threadId, cwd: fixture.worktree })
          expect(fixture.model.calls).toHaveLength(1)
        } finally {
          await cleanupFixture(fixture, replacement.child)
        }
      } finally {
        await cleanupFixture(fixture, fixture.child)
      }
    }
  )

  qualificationTest(
    "normal process restart: the same persisted thread reopens in the same registered worktree",
    async () => {
      const fixture = await runningFixture("accepted")
      const originalThreadId = fixture.threadId
      try {
        await runTurn(
          { ...fixture, threadId: originalThreadId },
          "run_id: qualification-run attempt_id: qualification-attempt restart"
        )
        await fixture.rpc.waitForNotification("turn/completed")
        await fixture.rpc.close()
        const replacement = await launchCodex(fixture)
        try {
          const read = await replacement.rpc.request("thread/read", { threadId: originalThreadId, includeTurns: true })
          expect(read.result?.["thread"]).toMatchObject({ id: originalThreadId, cwd: fixture.worktree })
        } finally {
          await cleanupFixture(fixture, replacement.child)
        }
      } finally {
        await cleanupFixture(fixture, fixture.child)
      }
    }
  )

  qualificationTest("safe suspension: interrupt reports completion only after the real active turn stops", async () => {
    const fixture = await runningFixture("holding")
    try {
      const started = await runTurn(
        { ...fixture, threadId: fixture.threadId },
        "run_id: qualification-run attempt_id: qualification-attempt interrupt"
      )
      await fixture.model.waitForCalls(1)
      const turn = Schema.decodeUnknownSync(IdentifiedProtocolValue)(started.result?.["turn"])
      const interrupted = await fixture.rpc.request("turn/interrupt", { threadId: fixture.threadId, turnId: turn.id })
      expect(interrupted.result).toBeDefined()
      const completed = await fixture.rpc.waitForNotification("turn/completed")
      expect(completed.params?.["turn"]).toMatchObject({ status: "interrupted" })
      expect(fixture.model.calls).toHaveLength(1)
    } finally {
      await cleanupFixture(fixture, fixture.child)
    }
  })

  qualificationTest(
    "stuck survivor: a held model request keeps the process live until the host explicitly stops it",
    async () => {
      const fixture = await runningFixture("holding")
      const observation = processObservationFor()
      try {
        await runTurn(
          { ...fixture, threadId: fixture.threadId },
          "run_id: qualification-run attempt_id: qualification-attempt stuck"
        )
        await fixture.model.waitForCalls(1)
        expect(observation.isLive(processId(fixture.child))).toBe(true)
        expect(fixture.model.calls).toHaveLength(1)
      } finally {
        await cleanupFixture(fixture, fixture.child)
      }
    }
  )

  qualificationTest("terminal seal: Accepted names the real Git commit while Failed remains distinct", async () => {
    const accepted = await runningFixture("accepted")
    try {
      await runTurn(
        { ...accepted, threadId: accepted.threadId },
        "run_id: qualification-run attempt_id: qualification-attempt accepted"
      )
      await accepted.rpc.waitForNotification("turn/completed")
      const head = await runGit(accepted.worktree, "rev-parse", "HEAD")
      expect(head).not.toBe(accepted.baseSha)
      expect(accepted.model.calls).toHaveLength(2)
    } finally {
      await cleanupFixture(accepted, accepted.child)
    }
    const failed = await runningFixture("failed")
    try {
      await runTurn(
        { ...failed, threadId: failed.threadId },
        "run_id: qualification-run attempt_id: qualification-attempt failed"
      )
      const completed = await failed.rpc.waitForNotification("turn/completed")
      expect(completed.params?.["turn"]).toMatchObject({ status: "failed" })
      expect(await runGit(failed.worktree, "rev-parse", "HEAD")).toBe(failed.baseSha)
    } finally {
      await cleanupFixture(failed, failed.child)
    }
  })

  qualificationTest(
    "graceful application Exit: close removes the real process and preserves the thread for a later process",
    async () => {
      const fixture = await runningFixture("accepted")
      const observation = processObservationFor()
      const originalThreadId = fixture.threadId
      try {
        await runTurn(
          { ...fixture, threadId: originalThreadId },
          "run_id: qualification-run attempt_id: qualification-attempt exit"
        )
        await fixture.rpc.waitForNotification("turn/completed")
        await fixture.rpc.close()
        await observation.waitAbsent(processId(fixture.child))
        const replacement = await launchCodex(fixture)
        try {
          const read = await replacement.rpc.request("thread/read", { threadId: originalThreadId, includeTurns: true })
          expect(read.result?.["thread"]).toMatchObject({ id: originalThreadId, cwd: fixture.worktree })
        } finally {
          await cleanupFixture(fixture, replacement.child)
        }
      } finally {
        await cleanupFixture(fixture, fixture.child)
      }
    }
  )

  describe.each([
    "before thread/start",
    "after thread/start before association",
    "after turn/start admission",
    "during interruption",
    "after terminal notification"
  ])("unexpected death at %s", (cut) => {
    qualificationTest(`${host} process-death cut ${cut} preserves no fabricated executor result`, async () => {
      const fixture = await createGitFixture(cut === "after terminal notification" ? "accepted" : "holding")
      const launched: {
        readonly child: ChildProcessWithoutNullStreams
        readonly rpc: JsonRpcFixtureClient
        readonly threadId?: string
      } = cut === "before thread/start" ? await launchCodexProcess(fixture) : await launchCodex(fixture)
      const observation = processObservationFor()
      try {
        if (
          cut === "after turn/start admission" ||
          cut === "during interruption" ||
          cut === "after terminal notification"
        ) {
          if (launched.threadId === undefined) throw new Error(`${cut} requires a materialized thread`)
          await runTurn(
            { ...fixture, child: launched.child, rpc: launched.rpc, threadId: launched.threadId },
            `run_id: qualification-run attempt_id: qualification-attempt ${cut}`
          )
        }
        if (cut === "during interruption") {
          await fixture.model.waitForCalls(1)
          const turnId = "turn-under-interruption"
          const interruption = launched.rpc.request("turn/interrupt", { threadId: launched.threadId, turnId })
          observation.signalGroup(processId(launched.child), "SIGKILL")
          await interruption.catch(() => undefined)
        } else {
          if (cut === "after turn/start admission") await fixture.model.waitForCalls(1)
          if (cut === "after terminal notification") await launched.rpc.waitForNotification("turn/completed")
          observation.signalGroup(processId(launched.child), "SIGKILL")
        }
        await observation.waitAbsent(processId(launched.child))
        expect(observation.isLive(processId(launched.child))).toBe(false)
        const expectedCalls =
          cut === "before thread/start" || cut === "after thread/start before association"
            ? 0
            : cut === "after terminal notification"
              ? 2
              : 1
        expect(fixture.model.calls).toHaveLength(expectedCalls)
        const replacement = await launchCodex(fixture)
        try {
          if (launched.threadId !== undefined) {
            const read = await replacement.rpc
              .request("thread/read", { threadId: launched.threadId, includeTurns: true })
              .catch(() => undefined)
            if (read !== undefined) expect(read.result?.["thread"]).toBeDefined()
          }
        } finally {
          await cleanupFixture(fixture, replacement.child)
        }
      } finally {
        await cleanupFixture(fixture, launched.child)
      }
    })
  })

  qualificationTest(
    "contradiction: missing real thread state is a typed RPC failure and starts no replacement turn",
    async () => {
      const fixture = await runningFixture("accepted")
      try {
        await expect(
          fixture.rpc.request("thread/read", { threadId: "foreign-thread-id", includeTurns: true })
        ).rejects.toThrow()
        expect(fixture.model.calls).toHaveLength(0)
      } finally {
        await cleanupFixture(fixture, fixture.child)
      }
    }
  )
})
