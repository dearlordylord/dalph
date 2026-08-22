/* eslint-disable import/no-nodejs-modules -- This opt-in qualification owns real local HTTP, Git, and OS boundaries. */
/* eslint-disable functional/immutable-data -- Disposable process and request observations are fixture-local. */
/* eslint-disable functional/no-throw-statements -- Fixture assertion helpers fail the active Vitest chronology directly. */
/* eslint-disable no-restricted-globals -- The explicit opt-in is read before the live suite is registered. */

import { execFile as nodeExecFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import type { Socket } from "node:net"
import { tmpdir } from "node:os"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import {
  CodexAttemptRecord,
  CodexServerLaunchRecord,
  type CodexAttemptRecord as CodexAttemptRecordType
} from "../../src/application/codex-attempt-store.js"
import { makeNodeCodexProcessGroupCensusService } from "../../src/application/codex-app-server.js"
import { AcceptedResultEvidenceManifest } from "@dalph/contracts"
import {
  CodexQualificationHostEvent,
  type CodexQualificationHostEvent as HostEvent
} from "../../bin/codex-qualification-host-contract.js"

const execFile = promisify(nodeExecFile)
const enabled = nodeProcess.env["DALPH_RUN_REAL_CODEX_QUALIFICATION"] === "1"
const supportedHost = nodeProcess.platform === "linux" || nodeProcess.platform === "darwin"
const qualificationTest = enabled && supportedHost ? it : it.skip
const hostExecutable = nodePath.resolve("packages/dalph/dist/bin/codex-qualification-host.js")
const codexExecutable = nodeProcess.env["CODEX_BIN"] ?? nodePath.resolve("node_modules/.bin/codex")

const git = async (cwd: string, ...args: ReadonlyArray<string>): Promise<string> =>
  (await execFile("git", args, { cwd, encoding: "utf8" })).stdout.trim()

const sse = (value: Record<string, unknown>): string => `data: ${JSON.stringify(value)}\n\n`

const created = (id: string): Record<string, unknown> => ({ type: "response.created", response: { id } })
const completed = (id: string): Record<string, unknown> => ({
  type: "response.completed",
  response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }
})
const failed = (id: string): Record<string, unknown> => ({
  type: "response.failed",
  response: { id, status: "failed", error: { code: "fixture_failure", message: "controlled failure" } }
})
const shellCommand = (_worktree: string): Record<string, unknown> => ({
  type: "response.output_item.done",
  item: {
    type: "function_call",
    call_id: "qualification-shell-command",
    name: "shell_command",
    arguments: JSON.stringify({
      command:
        "printf '%s\\n' real-codex-qualification > dalph-real-codex.txt && git add dalph-real-codex.txt && git commit -m dalph-real-codex-qualification >/dev/null && git rev-parse HEAD",
      workdir: _worktree,
      timeout_ms: 10_000
    })
  }
})
const longLivedShellCommand = (
  worktree: string,
  kind: "foreground" | "escaped" | "stuck"
): Record<string, unknown> => ({
  type: "response.output_item.done",
  item: {
    type: "function_call",
    call_id: "qualification-long-lived-shell-command",
    name: "shell_command",
    arguments: JSON.stringify({
      command:
        kind === "stuck"
          ? "sh -c 'trap \"\" TERM; while :; do sleep 1; done' </dev/null >/dev/null 2>&1 & printf '%s\\n' $! > .dalph-owned-child-pid"
          : kind === "escaped"
            ? "sh -c 'while :; do sleep 1; done' </dev/null >/dev/null 2>&1 & printf '%s\\n' $! > .dalph-owned-child-pid"
            : "printf '%s\\n' $$ > .dalph-owned-child-pid; while :; do sleep 1; done",
      workdir: worktree,
      timeout_ms: 60_000
    })
  }
})
const assistantMessage = (text: string): Record<string, unknown> => ({
  type: "response.output_item.done",
  item: {
    type: "message",
    role: "assistant",
    id: "qualification-assistant-message",
    content: [{ type: "output_text", text }]
  }
})

type ModelMode =
  | "accepted"
  | "accepted-race"
  | "failed"
  | "failed-race"
  | "holding"
  | "foreign"
  | "child"
  | "escaped-child"
  | "stuck-child"

class ResponsesFixture {
  readonly calls: Array<string> = []
  private readonly callWaiters = new Map<number, Array<() => void>>()
  private readonly sockets = new Set<Socket>()
  private readonly server: Server
  private readonly terminalRelease: Promise<void>
  private readonly terminalSent: Promise<void>
  private releaseTerminalResponse: () => void = () => undefined
  private markTerminalSent: () => void = () => undefined
  private closed = false

  constructor(
    private readonly mode: ModelMode,
    private readonly worktree: string
  ) {
    this.server = createServer((request, response) => void this.respond(request, response))
    this.terminalRelease = new Promise<void>((resolve) => {
      this.releaseTerminalResponse = resolve
    })
    this.terminalSent = new Promise<void>((resolve) => {
      this.markTerminalSent = resolve
    })
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", resolve)
    })
    const address = this.server.address()
    if (address === null || typeof address === "string") throw new Error("Responses fixture did not bind")
    return `http://127.0.0.1:${address.port}/v1`
  }

  waitForCalls(count: number, timeoutMilliseconds = 30_000): Promise<void> {
    if (this.calls.length >= count) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const present = this.callWaiters.get(count) ?? []
      const timeout = setTimeout(
        () => reject(new Error(`timed out waiting for model call ${count}`)),
        timeoutMilliseconds
      )
      this.callWaiters.set(count, [
        ...present,
        () => {
          clearTimeout(timeout)
          resolve()
        }
      ])
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.releaseTerminalResponse()
    for (const socket of this.sockets) socket.destroy()
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error === undefined ? resolve() : reject(error)))
    )
  }

  releaseTerminal(): void {
    this.releaseTerminalResponse()
  }

  waitForTerminalSent(): Promise<void> {
    return this.terminalSent
  }

  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.sockets.add(request.socket)
    request.socket.once("close", () => this.sockets.delete(request.socket))
    if (request.method !== "POST" || request.url?.split("?", 1)[0] !== "/v1/responses") {
      response.writeHead(404).end()
      return
    }
    const chunks: Array<Buffer> = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString("utf8")
    this.calls.push(body)
    for (const [count, waiters] of this.callWaiters) {
      if (this.calls.length < count) continue
      this.callWaiters.delete(count)
      for (const resolve of waiters) resolve()
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    const responseId = `qualification-response-${this.calls.length}`
    response.write(sse(created(responseId)))
    if (this.mode === "holding") return
    if ((this.mode === "escaped-child" || this.mode === "stuck-child") && this.calls.length > 1) return
    if (this.mode === "accepted-race" || this.mode === "failed-race") {
      await this.terminalRelease
      if (this.mode === "failed-race") {
        response.write(sse(failed(responseId)))
      } else {
        const correlation = { runId: "real-codex-qualification-run", attemptId: "real-codex-qualification-attempt" }
        response.write(
          sse(assistantMessage(JSON.stringify({ commit: await git(this.worktree, "rev-parse", "HEAD"), correlation })))
        )
        response.write(sse(completed(responseId)))
      }
      response.end()
      this.markTerminalSent()
      return
    }
    if (this.mode === "failed") {
      response.write(sse(failed(responseId)))
      response.end()
      return
    }
    if (this.calls.length === 1) {
      response.write(
        sse(
          this.mode === "child" || this.mode === "escaped-child" || this.mode === "stuck-child"
            ? longLivedShellCommand(
                this.worktree,
                this.mode === "stuck-child" ? "stuck" : this.mode === "escaped-child" ? "escaped" : "foreground"
              )
            : shellCommand(this.worktree)
        )
      )
    } else {
      const correlation =
        this.mode === "foreign"
          ? { runId: "foreign-run", attemptId: "foreign-attempt" }
          : { runId: "real-codex-qualification-run", attemptId: "real-codex-qualification-attempt" }
      response.write(
        sse(assistantMessage(JSON.stringify({ commit: await git(this.worktree, "rev-parse", "HEAD"), correlation })))
      )
    }
    response.write(sse(completed(responseId)))
    response.end()
  }
}

type HostAction =
  | "allocate"
  | "associate"
  | "association-cut"
  | "pre-thread-cut"
  | "create"
  | "turn"
  | "project"
  | "suspend"
  | "settle"
  | "exercise-suspension"
  | "exercise-terminal-suspension"
  | "exit"
  | "exit-stuck"
  | "close"

const requireEvent = <EventName extends HostEvent["event"]>(
  event: HostEvent,
  expected: EventName
): Extract<HostEvent, { readonly event: EventName }> | HostEvent => {
  if (event.event === "failure") throw new Error(event.detail ?? "qualification host failed without detail")
  if (event.event !== expected) throw new Error(`expected ${expected} event, received ${event.event}`)
  return event
}

class BuiltHost {
  readonly events: Array<HostEvent> = []
  private readonly waiters = new Map<HostEvent["event"], Array<(event: HostEvent) => void>>()
  private readonly reportWaiters = new Map<number, Array<(event: HostEvent) => void>>()
  private readonly exitPromise: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>
  private stderr = ""
  private buffer = ""
  private exited = false
  private exitStatus: { readonly code: number | null; readonly signal: NodeJS.Signals | null } | undefined

  constructor(
    readonly child: ChildProcessWithoutNullStreams,
    private readonly observeEvent: (event: HostEvent) => void = () => undefined
  ) {
    this.exitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        this.exited = true
        this.exitStatus = { code, signal }
        resolve({ code, signal })
      })
    })
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => this.consume(chunk))
    child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk
    })
    child.once("exit", () => {
      for (const waiters of this.waiters.values()) {
        for (const resolve of waiters) {
          resolve({ event: "failure", detail: `host exited: ${this.stderr}` })
        }
      }
      this.waiters.clear()
      for (const waiters of this.reportWaiters.values()) {
        for (const resolve of waiters) resolve({ event: "failure", detail: `host exited: ${this.stderr}` })
      }
      this.reportWaiters.clear()
    })
  }

  waitFor(event: HostEvent["event"]): Promise<HostEvent> {
    const present = this.events.find((candidate) => candidate.event === event)
    if (present !== undefined) return Promise.resolve(present)
    return new Promise<HostEvent>((resolve) => {
      const waiters = this.waiters.get(event) ?? []
      this.waiters.set(event, [...waiters, resolve])
    })
  }

  waitForReport(count: number): Promise<HostEvent> {
    const present = this.events.filter((candidate) => candidate.event === "report")[count - 1]
    if (present !== undefined) return Promise.resolve(present)
    return new Promise<HostEvent>((resolve) => {
      const waiters = this.reportWaiters.get(count) ?? []
      this.reportWaiters.set(count, [...waiters, resolve])
    })
  }

  async waitForExit(): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
    if (this.exitStatus !== undefined) return this.exitStatus
    return this.exitPromise
  }

  isLive(): boolean {
    return !this.exited
  }

  continue(): void {
    this.child.stdin.write("continue\n")
  }

  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    if (!this.isLive()) return
    const pid = this.child.pid
    if (pid === undefined) throw new Error("built qualification host did not expose a pid")
    try {
      nodeProcess.kill(-pid, signal)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("ESRCH")) throw error
    }
    await this.waitForExit()
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const boundary = this.buffer.indexOf("\n")
      if (boundary < 0) return
      const line = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 1)
      if (line.trim().length === 0) continue
      const event = Schema.decodeUnknownSync(CodexQualificationHostEvent)(JSON.parse(line))
      this.observeEvent(event)
      this.events.push(event)
      if (event.event === "failure") {
        for (const waiters of this.waiters.values()) {
          for (const resolve of waiters) resolve(event)
        }
        this.waiters.clear()
        for (const waiters of this.reportWaiters.values()) {
          for (const resolve of waiters) resolve(event)
        }
        this.reportWaiters.clear()
        continue
      }
      if (event.event === "report") {
        const count = this.events.filter((candidate) => candidate.event === "report").length
        const reportWaiters = this.reportWaiters.get(count) ?? []
        this.reportWaiters.delete(count)
        for (const resolve of reportWaiters) resolve(event)
      }
      const waiters = this.waiters.get(event.event) ?? []
      this.waiters.delete(event.event)
      for (const resolve of waiters) resolve(event)
    }
  }
}

type Fixture = {
  readonly root: string
  readonly repository: string
  readonly worktree: string
  readonly state: string
  readonly evidence: string
  readonly codexHome: string
  readonly baseSha: string
  readonly model: ResponsesFixture
}

type HostOptions = {
  readonly hold?: boolean
  readonly waitForOwnedChild?: boolean
  readonly runId?: string
  readonly attemptId?: string
  readonly taskId?: string
}

const privateSnapshotLineSchema = Schema.Struct({
  digest: Schema.String,
  formatVersion: Schema.Literal(1),
  payload: Schema.String
})
const privateSnapshotSchema = Schema.Struct({
  attempts: Schema.Array(CodexAttemptRecord),
  serverLaunch: Schema.NullOr(CodexServerLaunchRecord)
})
type PrivateSnapshot = typeof privateSnapshotSchema.Type

const latestPrivateSnapshot = async (fixture: Fixture): Promise<PrivateSnapshot> => {
  const text = await readFile(nodePath.join(fixture.state, "executor-private-state.json"), "utf8")
  const line = text
    .split("\n")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .at(-1)
  if (line === undefined) throw new Error("private state did not contain a complete snapshot")
  const document = Schema.decodeUnknownSync(privateSnapshotLineSchema)(JSON.parse(line))
  return Schema.decodeUnknownSync(privateSnapshotSchema)(JSON.parse(document.payload))
}

const attemptRecord = async (
  fixture: Fixture,
  runId = "real-codex-qualification-run",
  attemptId = "real-codex-qualification-attempt"
) => {
  const snapshot = await latestPrivateSnapshot(fixture)
  const record = snapshot.attempts.find(
    (candidate) => candidate.correlationRunId === runId && candidate.correlationAttemptId === attemptId
  )
  if (record === undefined) throw new Error(`private state has no attempt ${runId}/${attemptId}`)
  return record
}

const threadIdOf = (record: CodexAttemptRecordType): string | undefined =>
  record._tag === "EmptyPreTurn" ? undefined : record.threadId

const processIsLive = (pid: number): boolean => {
  try {
    nodeProcess.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && error.message.includes("ESRCH")) return false
    throw error
  }
}

const waitForProcessAbsence = async (pid: number): Promise<void> => {
  for (let remaining = 100; remaining > 0; remaining -= 1) {
    if (!processIsLive(pid)) return
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`process ${pid} remained live after the application Exit boundary`)
}

/** The disposable fixture may be removed only after the production process-group/token census is Absent. */
const waitForOwnedServerAbsence = async (launch: CodexServerLaunchRecord): Promise<void> => {
  if (launch.pid === null) return
  const census = makeNodeCodexProcessGroupCensusService()
  for (let remaining = 100; remaining > 0; remaining -= 1) {
    const projection = await Effect.runPromise(census.observe(launch))
    if (projection._tag === "Absent") return
    if (projection._tag === "Unreadable" || projection._tag === "Contradictory") {
      throw new Error(`cannot prove exact Codex cleanup for ${launch.pid}: ${projection.detail}`)
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Codex process group/token descendants remained for launch ${launch.pid}`)
}

const waitForOwnedChildPid = async (fixture: Fixture): Promise<number> => {
  const path = nodePath.join(fixture.worktree, ".dalph-owned-child-pid")
  for (let remaining = 200; remaining > 0; remaining -= 1) {
    try {
      const pid = Number((await readFile(path, "utf8")).trim())
      if (Number.isSafeInteger(pid) && pid > 0) return pid
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("real Codex shell activity did not publish its owned child pid")
}

const regularFilesBelow = async (directory: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = nodePath.join(directory, entry.name)
        return entry.isDirectory() ? regularFilesBelow(path) : Promise.resolve(entry.isFile() ? [path] : [])
      })
    )
  ).flat()
}

const onlyRolloutFile = async (fixture: Fixture): Promise<string> => {
  const rollouts = (await regularFilesBelow(fixture.codexHome)).filter(
    (path) => nodePath.basename(path).startsWith("rollout-") && path.endsWith(".jsonl")
  )
  if (rollouts.length !== 1) throw new Error(`expected one private Codex rollout, found ${rollouts.length}`)
  const rollout = rollouts[0]
  if (rollout === undefined) throw new Error("expected the sole private Codex rollout")
  return rollout
}

const suspensionRaceCases: ReadonlyArray<readonly [string, "failed-race" | "accepted-race"]> = [
  ["terminal failure wins over suspension", "failed-race"],
  ["terminal acceptance wins over suspension", "accepted-race"]
]

const acceptedEvidenceFor = async (fixture: Fixture, event: HostEvent): Promise<void> => {
  const report = requireEvent(event, "report").report
  if (report === undefined || report._tag !== "Terminal" || report.result._tag !== "Accepted") {
    throw new Error("expected an Accepted terminal host report")
  }
  const accepted = report.result.acceptedResult
  const evidencePath = nodePath.join(
    fixture.evidence,
    accepted.evidenceManifest.digest.slice(0, 2),
    accepted.evidenceManifest.digest
  )
  const bytes = await readFile(evidencePath)
  expect(bytes.byteLength).toBe(accepted.evidenceManifest.byteLength)
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(accepted.evidenceManifest.digest)
  const manifest = Schema.decodeUnknownSync(AcceptedResultEvidenceManifest)(JSON.parse(bytes.toString("utf8")))
  expect(manifest).toEqual({
    commit: accepted.commit,
    correlation: { runId: "real-codex-qualification-run", attemptId: "real-codex-qualification-attempt" },
    formatVersion: 1,
    outcome: "Accepted",
    predecessor: null
  })
}

const makeFixture = async (mode: ModelMode): Promise<Fixture> => {
  const root = await realpath(await mkdtemp(nodePath.join(tmpdir(), "dalph-real-codex-host-")))
  const repository = nodePath.join(root, "repository")
  const worktree = nodePath.join(root, "worktree")
  const state = nodePath.join(root, "state")
  const evidence = nodePath.join(root, "evidence")
  const codexHome = nodePath.join(root, "codex-home")
  await Promise.all([
    mkdir(repository),
    mkdir(state, { mode: 0o700 }),
    mkdir(evidence, { mode: 0o700 }),
    mkdir(codexHome, { mode: 0o700 })
  ])
  await git(repository, "init", "-q")
  await git(repository, "config", "user.name", "Dalph Qualification")
  await git(repository, "config", "user.email", "dalph-qualification@example.invalid")
  await writeFile(nodePath.join(repository, "README.md"), "qualification\n")
  await git(repository, "add", "README.md")
  await git(repository, "commit", "-qm", "qualification base")
  const baseSha = await git(repository, "rev-parse", "HEAD")
  await git(repository, "worktree", "add", "-q", "-b", "dalph/real-codex-qualification", worktree, baseSha)
  const model = new ResponsesFixture(mode, worktree)
  const endpoint = await model.start()
  await writeFile(
    nodePath.join(codexHome, "config.toml"),
    [
      'model_provider = "dalph-fixture"',
      'model = "dalph-fixture-model"',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      "[model_providers.dalph-fixture]",
      'name = "Dalph fixture"',
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
  )
  return { root, repository, worktree, state, evidence, codexHome, baseSha, model }
}

const spawnRawHost = (
  fixture: Fixture,
  action: HostAction,
  options: HostOptions = {},
  observeEvent: (event: HostEvent) => void = () => undefined
): BuiltHost => {
  const child = spawn(nodeProcess.execPath, [hostExecutable, action], {
    detached: true,
    env: {
      ...nodeProcess.env,
      CODEX_BIN: codexExecutable,
      CODEX_HOME: fixture.codexHome,
      OPENAI_API_KEY: "qualification-key",
      DALPH_CODEX_QUALIFICATION_WORKTREE: fixture.worktree,
      DALPH_CODEX_QUALIFICATION_STATE: fixture.state,
      DALPH_CODEX_QUALIFICATION_EVIDENCE: fixture.evidence,
      DALPH_CODEX_QUALIFICATION_BASE_SHA: fixture.baseSha,
      DALPH_CODEX_QUALIFICATION_HOLD: options.hold === true ? "1" : "0",
      DALPH_CODEX_QUALIFICATION_WAIT_FOR_OWNED_CHILD: options.waitForOwnedChild === true ? "1" : "0",
      DALPH_CODEX_QUALIFICATION_RUN_ID: options.runId ?? "real-codex-qualification-run",
      DALPH_CODEX_QUALIFICATION_ATTEMPT_ID: options.attemptId ?? "real-codex-qualification-attempt",
      DALPH_CODEX_QUALIFICATION_TASK_ID: options.taskId ?? "real-codex-qualification-task"
    },
    stdio: ["pipe", "pipe", "pipe"]
  })
  return new BuiltHost(child, observeEvent)
}

const spawnHost = async (fixture: Fixture, action: HostAction, options: HostOptions = {}): Promise<BuiltHost> => {
  const host = spawnRawHost(fixture, action, options)
  const ready = await host.waitFor("ready")
  if (ready.event === "failure") throw new Error(ready.detail)
  return host
}

const dispose = async (fixture: Fixture, hosts: ReadonlyArray<BuiltHost>): Promise<void> => {
  for (const host of hosts) await host.stop("SIGKILL")
  let launch: CodexServerLaunchRecord | null = null
  try {
    launch = (await latestPrivateSnapshot(fixture)).serverLaunch
    const closer = await spawnHost(fixture, "close")
    requireEvent(await closer.waitFor("closed"), "closed")
    const closeExit = await closer.waitForExit()
    if (closeExit.code !== 0 || closeExit.signal !== null) {
      throw new Error(`qualification cleanup host failed: ${JSON.stringify(closeExit)}`)
    }
    if (launch !== null) await waitForOwnedServerAbsence(launch)
  } finally {
    await fixture.model.close()
  }
  await rm(fixture.root, { recursive: true, force: true })
}

const exactProjectionReport = (event: HostEvent) => {
  const projection = requireEvent(event, "projection").projection
  if (projection === undefined || projection._tag !== "Exact") {
    throw new Error(`expected Exact projection, got ${JSON.stringify(projection)}`)
  }
  return projection.report
}

const terminalReport = (event: HostEvent) => {
  const report = event.event === "report" ? event.report : exactProjectionReport(event)
  if (report === undefined || report._tag !== "Terminal") {
    throw new Error(`expected terminal executor report, got ${JSON.stringify(event)}`)
  }
  return report
}

describe("#75 built Dalph PlannedAttemptExecutor qualification", () => {
  qualificationTest(
    "built create reports Running, process restart projects the same thread as terminal Accepted, and rereads evidence",
    async () => {
      const fixture = await makeFixture("accepted")
      const hosts: Array<BuiltHost> = []
      try {
        const first = await spawnHost(fixture, "settle")
        hosts.push(first)
        expect(requireEvent(await first.waitForReport(1), "report").report?._tag).toBe("Running")
        expect(terminalReport(await first.waitForReport(2)).result._tag).toBe("Accepted")
        await first.waitForExit()
        const before = await attemptRecord(fixture)
        const originalThread = threadIdOf(before)
        expect(originalThread).toBeDefined()

        const resumed = await spawnHost(fixture, "project")
        hosts.push(resumed)
        const projected = await resumed.waitFor("projection")
        const terminal = terminalReport(projected)
        expect(terminal.result._tag).toBe("Accepted")
        await acceptedEvidenceFor(fixture, { event: "report", command: "StartOrContinue", report: terminal })
        expect(threadIdOf(await attemptRecord(fixture))).toBe(originalThread)
        expect(fixture.model.calls).toHaveLength(2)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "normal built host returns Running then the sealed Accepted commit without exposing its Codex thread id",
    async () => {
      const fixture = await makeFixture("accepted")
      const hosts: Array<BuiltHost> = []
      try {
        const started = await spawnHost(fixture, "settle")
        hosts.push(started)
        const running = requireEvent(await started.waitForReport(1), "report")
        expect(running.report?._tag).toBe("Running")
        const terminal = requireEvent(await started.waitForReport(2), "report")
        expect(terminal.report?._tag).toBe("Terminal")
        if (terminal.report?._tag === "Terminal") {
          expect(terminal.report.result._tag).toBe("Accepted")
          if (terminal.report.result._tag === "Accepted") {
            expect(terminal.report.result.acceptedResult.commit).toBe(await git(fixture.worktree, "rev-parse", "HEAD"))
          }
        }
        await acceptedEvidenceFor(fixture, terminal)
        expect((await attemptRecord(fixture))._tag).toBe("Terminal")
        expect(fixture.model.calls).toHaveLength(2)
        expect(JSON.stringify(started.events)).not.toContain("threadId")
      } finally {
        await dispose(fixture, hosts)
      }
    },
    30_000
  )

  qualificationTest(
    "real failed turn becomes Terminal Failed and never Completed",
    async () => {
      const fixture = await makeFixture("failed")
      const hosts: Array<BuiltHost> = []
      try {
        const started = await spawnHost(fixture, "settle")
        hosts.push(started)
        expect(requireEvent(await started.waitForReport(1), "report").report?._tag).toBe("Running")
        const terminal = requireEvent(await started.waitForReport(2), "report")
        expect(terminal.report?._tag).toBe("Terminal")
        if (terminal.report?._tag === "Terminal") {
          expect(terminal.report.result._tag).toBe("Failed")
        }
        expect(JSON.stringify(terminal)).not.toContain("Completed")
      } finally {
        await dispose(fixture, hosts)
      }
    },
    30_000
  )

  qualificationTest(
    "a killed empty allocation is replaceable before the first task turn and sends no duplicate task turn",
    async () => {
      const fixture = await makeFixture("accepted")
      const hosts: Array<BuiltHost> = []
      try {
        const allocated = await spawnHost(fixture, "allocate", { hold: true })
        hosts.push(allocated)
        requireEvent(await allocated.waitFor("allocated"), "allocated")
        expect(fixture.model.calls).toHaveLength(0)
        await allocated.stop("SIGKILL")

        const replacement = await spawnHost(fixture, "settle")
        hosts.push(replacement)
        expect(requireEvent(await replacement.waitForReport(1), "report").report?._tag).toBe("Running")
        const terminal = terminalReport(await replacement.waitForReport(2))
        expect(terminal.result._tag).toBe("Accepted")
        expect(fixture.model.calls).toHaveLength(2)
        expect((await attemptRecord(fixture))._tag).toBe("Terminal")
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "a killed associated empty thread is replaced only after Codex proves its no-turn rollout absent",
    async () => {
      const fixture = await makeFixture("accepted")
      const hosts: Array<BuiltHost> = []
      try {
        const associated = await spawnHost(fixture, "associate", { hold: true })
        hosts.push(associated)
        requireEvent(await associated.waitFor("associated"), "associated")
        const originalThread = threadIdOf(await attemptRecord(fixture))
        expect(originalThread).toBeDefined()
        expect(fixture.model.calls).toHaveLength(0)
        await associated.stop("SIGKILL")

        const resumed = await spawnHost(fixture, "settle")
        hosts.push(resumed)
        expect(requireEvent(await resumed.waitForReport(1), "report").report?._tag).toBe("Running")
        expect(terminalReport(await resumed.waitForReport(2)).result._tag).toBe("Accepted")
        const replacementThread = threadIdOf(await attemptRecord(fixture))
        expect(replacementThread).toBeDefined()
        expect(replacementThread).not.toBe(originalThread)
        expect(fixture.model.calls).toHaveLength(2)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "Dalph death while the production executor writes the private association starts exactly one later task turn",
    async () => {
      const fixture = await makeFixture("accepted")
      const hosts: Array<BuiltHost> = []
      try {
        const writing = await spawnHost(fixture, "association-cut")
        hosts.push(writing)
        requireEvent(await writing.waitFor("association-write-started"), "association-write-started")
        expect(fixture.model.calls).toHaveLength(0)
        const before = await attemptRecord(fixture)
        expect(before._tag).toBe("EmptyPreTurn")
        await writing.stop("SIGKILL")
        expect(JSON.stringify(writing.events)).not.toContain("Terminal")

        const replacement = await spawnHost(fixture, "settle")
        hosts.push(replacement)
        expect(requireEvent(await replacement.waitForReport(1), "report").report?._tag).toBe("Running")
        expect(terminalReport(await replacement.waitForReport(2)).result._tag).toBe("Accepted")
        expect(fixture.model.calls).toHaveLength(2)
        expect((await attemptRecord(fixture))._tag).toBe("Terminal")
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "restart stops a real escaped token child after the prior app-server leader is gone and before replacement admission",
    async () => {
      const fixture = await makeFixture("escaped-child")
      const hosts: Array<BuiltHost> = []
      try {
        const first = await spawnHost(fixture, "create", { hold: true })
        hosts.push(first)
        expect(requireEvent(await first.waitForReport(1), "report").report?._tag).toBe("Running")
        await fixture.model.waitForCalls(1)
        const ownedChildPid = await waitForOwnedChildPid(fixture)
        const originalThread = threadIdOf(await attemptRecord(fixture))
        const priorAppServerPid = (await latestPrivateSnapshot(fixture)).serverLaunch?.pid
        expect(priorAppServerPid).not.toBeNull()
        expect(priorAppServerPid).toBeDefined()
        expect(processIsLive(ownedChildPid)).toBe(true)

        await first.stop("SIGKILL")
        if (priorAppServerPid !== null && priorAppServerPid !== undefined) {
          nodeProcess.kill(priorAppServerPid, "SIGKILL")
          await waitForProcessAbsence(priorAppServerPid)
        }
        expect(processIsLive(ownedChildPid)).toBe(true)
        const callsBeforeReplacement = fixture.model.calls.length

        let childLiveAtReplacementReady: boolean | undefined
        const replacement = spawnRawHost(fixture, "project", {}, (event) => {
          if (event.event === "ready") childLiveAtReplacementReady = processIsLive(ownedChildPid)
        })
        hosts.push(replacement)
        requireEvent(await replacement.waitFor("ready"), "ready")
        expect(childLiveAtReplacementReady).toBe(false)
        expect(processIsLive(ownedChildPid)).toBe(false)
        expect(threadIdOf(await attemptRecord(fixture))).toBe(originalThread)
        const replacementPid = (await latestPrivateSnapshot(fixture)).serverLaunch?.pid
        expect(replacementPid).not.toBe(priorAppServerPid)
        expect(fixture.model.calls).toHaveLength(callsBeforeReplacement)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "a lost turn response is reconciled on restart with the same private thread and no duplicate task turn",
    async () => {
      const fixture = await makeFixture("holding")
      const hosts: Array<BuiltHost> = []
      try {
        const first = await spawnHost(fixture, "create", { hold: true })
        hosts.push(first)
        expect(requireEvent(await first.waitForReport(1), "report").report?._tag).toBe("Running")
        await fixture.model.waitForCalls(1)
        const originalThread = threadIdOf(await attemptRecord(fixture))
        expect(originalThread).toBeDefined()
        const priorAppServerPid = (await latestPrivateSnapshot(fixture)).serverLaunch?.pid
        expect(priorAppServerPid).not.toBeNull()
        expect(priorAppServerPid).toBeDefined()
        await first.stop("SIGKILL")
        if (priorAppServerPid !== null && priorAppServerPid !== undefined)
          expect(processIsLive(priorAppServerPid)).toBe(true)

        const projectedHost = await spawnHost(fixture, "project")
        hosts.push(projectedHost)
        if (priorAppServerPid !== null && priorAppServerPid !== undefined)
          await waitForProcessAbsence(priorAppServerPid)
        const projected = await projectedHost.waitFor("projection")
        if (projected.event === "projection" && projected.projection?._tag === "Exact") {
          expect(["Running", "Terminal"]).toContain(projected.projection.report._tag)
          if (projected.projection.report._tag === "Terminal") {
            expect(projected.projection.report.result._tag).not.toBe("Completed")
          }
        } else {
          expect(projected.event).toBe("projection")
          if (projected.event === "projection") expect(["Unreadable", "NoReport"]).toContain(projected.projection?._tag)
        }
        expect(threadIdOf(await attemptRecord(fixture))).toBe(originalThread)

        const continued = await spawnHost(fixture, "turn")
        hosts.push(continued)
        const continuation = await continued.waitForReport(1)
        if (continuation.event === "report") expect(continuation.report?._tag).not.toBe("Terminal")
        expect(fixture.model.calls).toHaveLength(1)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "active real turn suspends only through the normalized executor boundary",
    async () => {
      const fixture = await makeFixture("child")
      const hosts: Array<BuiltHost> = []
      try {
        const started = await spawnHost(fixture, "exercise-suspension", { waitForOwnedChild: true })
        hosts.push(started)
        expect(requireEvent(await started.waitForReport(1), "report").report?._tag).toBe("Running")
        const ownedChildPid = await waitForOwnedChildPid(fixture)
        const report = requireEvent(await started.waitForReport(2), "report")
        expect(report.command).toBe("Suspend")
        expect(report.report?._tag).toBe("SafelySuspended")
        expect(processIsLive(ownedChildPid)).toBe(false)
        await waitForProcessAbsence(ownedChildPid)
        expect(fixture.model.calls).toHaveLength(1)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    30_000
  )

  qualificationTest(
    "safe suspension preserves the exact thread and a later built host resumes it",
    async () => {
      const fixture = await makeFixture("holding")
      const hosts: Array<BuiltHost> = []
      try {
        const suspended = await spawnHost(fixture, "exercise-suspension")
        hosts.push(suspended)
        expect(requireEvent(await suspended.waitForReport(1), "report").report?._tag).toBe("Running")
        const originalThread = threadIdOf(await attemptRecord(fixture))
        expect(originalThread).toBeDefined()
        const report = requireEvent(await suspended.waitForReport(2), "report")
        expect(report.command).toBe("Suspend")
        expect(report.report?._tag).toBe("SafelySuspended")
        expect(fixture.model.calls).toHaveLength(1)

        const resumed = await spawnHost(fixture, "turn")
        hosts.push(resumed)
        expect(requireEvent(await resumed.waitForReport(1), "report").report?._tag).toBe("Running")
        expect(threadIdOf(await attemptRecord(fixture))).toBe(originalThread)
        expect(fixture.model.calls).toHaveLength(1)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "unresolved executor activity makes the real application Exit time out without releasing its position",
    async () => {
      const fixture = await makeFixture("stuck-child")
      const hosts: Array<BuiltHost> = []
      try {
        const survivor = await spawnHost(fixture, "exit-stuck", { waitForOwnedChild: true })
        hosts.push(survivor)
        expect(requireEvent(await survivor.waitForReport(1), "report").report?._tag).toBe("Running")
        await fixture.model.waitForCalls(1)
        const ownedChildPid = await waitForOwnedChildPid(fixture)
        const appServerPid = (await latestPrivateSnapshot(fixture)).serverLaunch?.pid
        expect(appServerPid).not.toBeNull()
        expect(appServerPid).toBeDefined()
        const result = requireEvent(await survivor.waitFor("exit-result"), "exit-result").exitResult
        expect(result?._tag).toBe("TimedOut")
        expect(result?.requestedStatus).toBe(1)
        expect(survivor.events.filter((event) => event.event === "report")).toHaveLength(1)
        expect(survivor.events.some((event) => event.event === "suspension-unresolved")).toBe(true)
        expect(
          survivor.events.some((event) => event.event === "exit-trace" && event.detail === "AdmissionCutoffClosed")
        ).toBe(true)
        if (appServerPid !== null && appServerPid !== undefined) expect(processIsLive(appServerPid)).toBe(true)
        expect(processIsLive(ownedChildPid)).toBe(true)
        expect(survivor.isLive()).toBe(true)
        expect((await attemptRecord(fixture))._tag).not.toBe("Terminal")
        nodeProcess.kill(ownedChildPid, "SIGKILL")
        await waitForProcessAbsence(ownedChildPid)
        expect(await survivor.waitForExit()).toEqual({ code: 1, signal: null })
        if (appServerPid !== null && appServerPid !== undefined) await waitForProcessAbsence(appServerPid)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "the Exit action safely suspends before closing the owner and the next host resumes the same thread",
    async () => {
      const fixture = await makeFixture("holding")
      const hosts: Array<BuiltHost> = []
      try {
        const exited = await spawnHost(fixture, "exit")
        hosts.push(exited)
        const started = requireEvent(await exited.waitForReport(1), "report")
        expect(started.command).toBe("StartOrContinue")
        expect(started.report?._tag).toBe("Running")
        const appServerPid = (await latestPrivateSnapshot(fixture)).serverLaunch?.pid
        expect(appServerPid).not.toBeNull()
        expect(appServerPid).toBeDefined()
        const report = requireEvent(await exited.waitForReport(2), "report")
        expect(report.command).toBe("Suspend")
        expect(report.report?._tag).toBe("SafelySuspended")
        const originalThread = threadIdOf(await attemptRecord(fixture))
        expect(originalThread).toBeDefined()
        const result = requireEvent(await exited.waitFor("exit-result"), "exit-result").exitResult
        expect(result).toEqual({ _tag: "Succeeded", requestedStatus: 0 })
        expect(exited.events.filter((event) => event.event === "exit-trace").map((event) => event.detail)).toEqual(
          expect.arrayContaining([
            "AdmissionCutoffClosed",
            "RunningExecutorWorkReachedSafeBoundary",
            "ProcessLocalResourcesClosed",
            "CoordinatorLockReleased",
            "ExitResultReported",
            "ProcessEndRequested"
          ])
        )
        expect(await exited.waitForExit()).toEqual({ code: 0, signal: null })
        if (appServerPid !== null && appServerPid !== undefined) await waitForProcessAbsence(appServerPid)

        const resumed = await spawnHost(fixture, "turn")
        hosts.push(resumed)
        expect(requireEvent(await resumed.waitForReport(1), "report").report?._tag).toBe("Running")
        expect(threadIdOf(await attemptRecord(fixture))).toBe(originalThread)
        expect(fixture.model.calls).toHaveLength(1)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "a foreign final correlation cannot fabricate Accepted and projects as a non-completed terminal result",
    async () => {
      const fixture = await makeFixture("foreign")
      const hosts: Array<BuiltHost> = []
      try {
        const started = await spawnHost(fixture, "settle")
        hosts.push(started)
        expect(requireEvent(await started.waitForReport(1), "report").report?._tag).toBe("Running")
        const terminal = terminalReport(await started.waitForReport(2))
        expect(terminal.result._tag).toBe("Failed")
        expect(terminal.result._tag).not.toBe("Completed")
        expect(fixture.model.calls).toHaveLength(2)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "a foreign project correlation returns NoReport instead of reusing another attempt's report",
    async () => {
      const fixture = await makeFixture("accepted")
      const hosts: Array<BuiltHost> = []
      try {
        const started = await spawnHost(fixture, "settle")
        hosts.push(started)
        expect(terminalReport(await started.waitForReport(2)).result._tag).toBe("Accepted")
        const foreign = await spawnHost(fixture, "project", {
          runId: "foreign-run",
          attemptId: "foreign-attempt",
          taskId: "foreign-task"
        })
        hosts.push(foreign)
        const projection = requireEvent(await foreign.waitFor("projection"), "projection").projection
        expect(projection?._tag).toBe("NoReport")
        expect(JSON.stringify(projection)).not.toContain("Terminal")
        expect(fixture.model.calls).toHaveLength(2)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "a missing real Codex rollout after an ambiguous turn projects Unreadable without replacement model work",
    async () => {
      const fixture = await makeFixture("holding")
      const hosts: Array<BuiltHost> = []
      try {
        const running = await spawnHost(fixture, "create", { hold: true })
        hosts.push(running)
        expect(requireEvent(await running.waitForReport(1), "report").report?._tag).toBe("Running")
        await fixture.model.waitForCalls(1)
        const rollout = await onlyRolloutFile(fixture)
        await running.stop("SIGKILL")
        await rm(rollout)

        const projected = await spawnHost(fixture, "project")
        hosts.push(projected)
        expect(requireEvent(await projected.waitFor("projection"), "projection").projection?._tag).toBe("Unreadable")
        expect(fixture.model.calls).toHaveLength(1)
        expect((await attemptRecord(fixture))._tag).not.toBe("Terminal")
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest.each([
    ["malformed", async (rollout: string) => writeFile(rollout, "{malformed rollout\n")],
    ["unreadable", async (rollout: string) => chmod(rollout, 0o000)]
  ] as const)(
    "a %s real Codex rollout projects Unreadable without replacement model work",
    async (_name, corrupt) => {
      const fixture = await makeFixture("holding")
      const hosts: Array<BuiltHost> = []
      let rollout: string | undefined
      try {
        const running = await spawnHost(fixture, "create", { hold: true })
        hosts.push(running)
        expect(requireEvent(await running.waitForReport(1), "report").report?._tag).toBe("Running")
        await fixture.model.waitForCalls(1)
        rollout = await onlyRolloutFile(fixture)
        await running.stop("SIGKILL")
        await corrupt(rollout)

        const projected = await spawnHost(fixture, "project")
        hosts.push(projected)
        expect(requireEvent(await projected.waitFor("projection"), "projection").projection?._tag).toBe("Unreadable")
        expect(fixture.model.calls).toHaveLength(1)
        expect((await attemptRecord(fixture))._tag).not.toBe("Terminal")
      } finally {
        if (rollout !== undefined) await chmod(rollout, 0o600).catch(() => undefined)
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "unexpected death at the ready boundary produces no fabricated report before thread/start",
    async () => {
      const fixture = await makeFixture("accepted")
      const hosts: Array<BuiltHost> = []
      try {
        const early = await spawnHost(fixture, "pre-thread-cut")
        hosts.push(early)
        await early.stop("SIGKILL")
        expect(fixture.model.calls).toHaveLength(0)
        const snapshot = await latestPrivateSnapshot(fixture)
        expect(snapshot.attempts.every((record) => record._tag === "EmptyPreTurn")).toBe(true)
        expect(JSON.stringify(early.events)).not.toContain("Terminal")
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "unexpected death after terminal notification preserves the sealed result for the next process",
    async () => {
      const fixture = await makeFixture("accepted")
      const hosts: Array<BuiltHost> = []
      try {
        const completed = await spawnHost(fixture, "settle")
        hosts.push(completed)
        const terminal = terminalReport(await completed.waitForReport(2))
        expect(terminal.result._tag).toBe("Accepted")
        const completedRecord = await attemptRecord(fixture)
        expect(completedRecord._tag).toBe("Terminal")
        const before = threadIdOf(completedRecord)
        await completed.stop("SIGKILL")
        const reread = await spawnHost(fixture, "project")
        hosts.push(reread)
        expect(terminalReport(await reread.waitFor("projection")).result._tag).toBe("Accepted")
        expect(threadIdOf(await attemptRecord(fixture))).toBe(before)
        expect(fixture.model.calls).toHaveLength(2)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest(
    "unexpected Dalph death during the real interruption boundary reconciles without safe or replacement work",
    async () => {
      const fixture = await makeFixture("holding")
      const hosts: Array<BuiltHost> = []
      try {
        const interrupted = await spawnHost(fixture, "exercise-suspension")
        hosts.push(interrupted)
        expect(requireEvent(await interrupted.waitForReport(1), "report").report?._tag).toBe("Running")
        await fixture.model.waitForCalls(1)
        const originalThread = threadIdOf(await attemptRecord(fixture))
        expect(originalThread).toBeDefined()
        const priorAppServerPid = (await latestPrivateSnapshot(fixture)).serverLaunch?.pid
        requireEvent(await interrupted.waitFor("suspension-requested"), "suspension-requested")
        await interrupted.stop("SIGKILL")
        expect(
          interrupted.events.some((event) => event.event === "report" && event.report?._tag === "SafelySuspended")
        ).toBe(false)

        const projected = await spawnHost(fixture, "project")
        hosts.push(projected)
        if (priorAppServerPid !== null && priorAppServerPid !== undefined)
          await waitForProcessAbsence(priorAppServerPid)
        const projection = requireEvent(await projected.waitFor("projection"), "projection").projection
        expect(["Exact", "Unreadable"]).toContain(projection?._tag)
        if (projection?._tag === "Exact") expect(projection.report._tag).not.toBe("SafelySuspended")
        expect(threadIdOf(await attemptRecord(fixture))).toBe(originalThread)
        expect(fixture.model.calls).toHaveLength(1)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )

  qualificationTest.each(suspensionRaceCases)(
    "%s at the built host boundary",
    async (_name, mode) => {
      const fixture = await makeFixture(mode)
      const hosts: Array<BuiltHost> = []
      try {
        const exercised = await spawnHost(fixture, "exercise-terminal-suspension")
        hosts.push(exercised)
        expect(requireEvent(await exercised.waitForReport(1), "report").report?._tag).toBe("Running")
        requireEvent(await exercised.waitFor("suspension-ready"), "suspension-ready")
        fixture.model.releaseTerminal()
        await fixture.model.waitForTerminalSent()
        exercised.continue()
        requireEvent(await exercised.waitFor("suspension-requested"), "suspension-requested")
        const terminal = terminalReport(await exercised.waitForReport(2))
        expect(terminal.result._tag).toBe(mode === "accepted-race" ? "Accepted" : "Failed")
        expect(terminal.result._tag).not.toBe("Completed")
        expect(
          exercised.events.some((event) => event.event === "report" && event.report?._tag === "SafelySuspended")
        ).toBe(false)
      } finally {
        await dispose(fixture, hosts)
      }
    },
    45_000
  )
})
