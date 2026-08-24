/* eslint-disable import/no-nodejs-modules -- this opt-in qualification owns disposable process, Git, and HTTP boundaries. */
/* eslint-disable functional/immutable-data -- the disposable fixture records its own process and endpoint observations. */
/* eslint-disable functional/no-throw-statements -- setup failures must fail the qualification rather than be hidden. */
/* eslint-disable no-restricted-globals -- the explicit opt-in is read before the real-process test is registered. */

import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { execFile as nodeExecFile } from "node:child_process"
import { createServer, type Server } from "node:http"
import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { Effect, Exit, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  AcceptedResult,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  GitCommonDirectoryTarget,
  Integrator,
  IntegratorRequest,
  IntegratorCandidateResourceLocator,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition,
  nodeGitCommandLayer,
  productionCoordinatorOwnershipLayer
} from "@dalph/orchestrator"
import { codexAppServerNodeLayer, nodeCodexOwnedActivityCensusLayer } from "./codex-app-server.js"
import { memoryCodexAttemptStoreLayer } from "./codex-attempt-store.js"
import {
  CodexIntegratorConfiguration,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  nodeCodexIntegratorLayer
} from "./codex-integrator.js"

const execFile = promisify(nodeExecFile)
const qualificationEnabled = nodeProcess.env["DALPH_RUN_REAL_CODEX_QUALIFICATION"] === "1"

const appServerFixture = String.raw`#!/usr/bin/env node
const fs = require("node:fs")
let buffer = ""
const statePath = process.env.DALPH_QUALIFICATION_STATE
const loadState = () => {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")) } catch { return { threads: [] } }
}
let state = loadState()
const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state))
const write = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
const writeError = (id) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: "fixture response lost" } }) + "\n")
const threadFor = (thread) => ({ id: thread.id, cwd: thread.cwd, status: "idle", turns: thread.turns })
const tokenFrom = (message) => message?.params?.input?.[0]?.text?.match(/dalph-owned-turn-token:v1:([^\s>]+)\s-->/)?.[1]
const modelCall = async () => {
  const endpoint = process.env.DALPH_QUALIFICATION_MODEL_ENDPOINT
  if (endpoint !== undefined) await fetch(endpoint, { method: "POST", body: "qualification-model-request" })
}
const respond = async (message) => {
  if (message.method === "initialized") return
  if (message.method === "initialize") {
    write(message.id, { userAgent: "dalph-integrator-qualification", codexHome: process.env.CODEX_HOME || "/tmp", platformFamily: "unix", platformOs: "linux" })
    return
  }
  if (message.method === "thread/list") {
    write(message.id, { data: state.threads.map((thread) => ({ ...threadFor(thread), turns: [] })) })
    return
  }
  if (message.method === "thread/start") {
    const thread = state.threads[0] || { id: "qualification-thread", cwd: message.params.cwd, turns: [] }
    if (state.threads.length === 0) state.threads.push(thread)
    saveState()
    write(message.id, { thread: threadFor(thread) })
    return
  }
  if (message.method === "thread/resume") {
    const thread = state.threads.find((item) => item.id === message.params.threadId)
    if (thread === undefined) return writeError(message.id)
    write(message.id, { thread: threadFor(thread) })
    return
  }
  if (message.method === "turn/start") {
    const thread = state.threads.find((item) => item.id === message.params.threadId)
    if (thread === undefined) return writeError(message.id)
    const token = tokenFrom(message)
    const turn = {
      id: "qualification-turn",
      status: "completed",
      input: [{ type: "text", text: "<!-- dalph-owned-turn-token:v1:" + token + " -->" }],
      items: [{ type: "agentMessage", text: "{\"version\":1,\"outcome\":\"PreparedCandidate\",\"candidate\":\"real-process-candidate\"}" }]
    }
    thread.turns = [turn]
    saveState()
    await modelCall()
    if (process.env.DALPH_QUALIFICATION_LOSE_TURN_RESPONSE === "1") return writeError(message.id)
    write(message.id, { turn })
    return
  }
  if (message.method === "thread/backgroundTerminals/list") return write(message.id, { data: [] })
  if (message.method === "thread/backgroundTerminals/terminate") return write(message.id, { terminated: true })
  write(message.id, {})
}
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n")
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() !== "") void respond(JSON.parse(line))
  }
})
`

const git = async (directory: string, ...args: ReadonlyArray<string>): Promise<string> => {
  const result = await execFile("git", ["-C", directory, ...args])
  return String(result.stdout).trim()
}

const modelServerFor = async (): Promise<{
  readonly endpoint: string
  readonly calls: Array<string>
  readonly server: Server
}> => {
  const calls: Array<string> = []
  const server = createServer((request, response) => {
    const chunks: Array<Buffer> = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      calls.push(Buffer.concat(chunks).toString("utf8"))
      response.writeHead(200, { "content-type": "application/json" })
      response.end("{}")
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("qualification model endpoint did not bind")
  return { endpoint: `http://127.0.0.1:${address.port}/model`, calls, server }
}

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error)))
  )
}

describe("#258 disposable real-process Codex Integrator qualification", () => {
  it.skipIf(!qualificationEnabled)(
    "recovers one unfinished run after the app-server process is replaced",
    async () => {
      const root = await realpath(
        await mkdtemp(nodePath.join(nodeProcess.env["TMPDIR"] ?? "/tmp", "dalph-integrator-real-"))
      )
      const repository = nodePath.join(root, "repository")
      const candidateRoot = nodePath.join(root, "candidates")
      const codexHome = nodePath.join(root, "codex-home")
      const statePath = nodePath.join(root, "codex-state.json")
      const privateStore = nodePath.join(root, "integrator-store.json")
      const executable = nodePath.join(root, "codex-fixture")
      const model = await modelServerFor()
      try {
        await mkdir(repository, { recursive: true })
        await mkdir(candidateRoot, { recursive: true })
        await mkdir(codexHome, { recursive: true })
        await writeFile(executable, appServerFixture)
        await chmod(executable, 0o755)
        await git(repository, "init", "-q")
        await git(repository, "config", "user.email", "dalph-integrator-qualification@example.invalid")
        await git(repository, "config", "user.name", "Dalph Integrator Qualification")
        await writeFile(nodePath.join(repository, "README.md"), "qualification\n")
        await git(repository, "add", "README.md")
        await git(repository, "commit", "-qm", "qualification base")
        const head = GitCommitSha.make(await git(repository, "rev-parse", "HEAD"))
        const commonDirectory = await realpath(
          nodePath.join(repository, await git(repository, "rev-parse", "--git-common-dir"))
        )
        const config = CodexIntegratorConfiguration.make({
          candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make(candidateRoot),
          commonDirectory,
          privateStoreLocator: IntegratorPrivateStoreLocator.make(privateStore),
          repository: GitRepositoryLocator.make(repository)
        })
        const session = IntegratorSessionCorrelation.make({
          acceptedResult: AcceptedResult.make({
            commit: head,
            evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: "0".repeat(64) })
          }),
          candidateResource: IntegratorCandidateResourceLocator.make("qualification-candidate"),
          expectedTargetHead: head,
          integrationTarget: IntegrationTarget.make({
            repository: GitRepositoryLocator.make(repository),
            ref: IntegrationTargetRef.make("refs/heads/master")
          }),
          plannedAttempt: PlannedTaskAttempt.make({
            attemptId: "qualification-attempt",
            baseSha: head,
            branch: TaskBranchRef.make("refs/heads/qualification"),
            executor: TaskExecutorLocator.make("qualification-executor"),
            runId: "qualification-run",
            taskId: TaskId.make("qualification-task"),
            taskRevision: TaskRevision.make("qualification-revision"),
            worktree: WorktreeLocator.make(nodePath.join(root, "planned-worktree"))
          }),
          queuedAt: JournalPosition.make(1),
          sessionId: IntegratorSessionId.make("qualification-session"),
          startedAt: JournalPosition.make(2),
          targetLineageObservedAt: JournalPosition.make(3)
        })
        const request = IntegratorRequest.make({
          correlation: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
        })
        const providerFor = (loseResponse: boolean) => {
          const app = codexAppServerNodeLayer({
            executable,
            environment: {
              CODEX_HOME: codexHome,
              DALPH_QUALIFICATION_MODEL_ENDPOINT: model.endpoint,
              DALPH_QUALIFICATION_STATE: statePath,
              DALPH_QUALIFICATION_LOSE_TURN_RESPONSE: loseResponse ? "1" : "0"
            }
          }).pipe(Layer.provide(memoryCodexAttemptStoreLayer()), Layer.provide(NodeServices.layer))
          const ownership = productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(commonDirectory)).pipe(
            Layer.provide(NodeFileSystem.layer)
          )
          const integrator = nodeCodexIntegratorLayer(config)
            .pipe(Layer.provide(nodeCodexOwnedActivityCensusLayer))
            .pipe(Layer.provide(app))
            .pipe(Layer.provide(NodeFileSystem.layer))
            .pipe(Layer.provide(nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer))))
            .pipe(Layer.provide(ownership))
          return integrator
        }
        const firstExit = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const integrator = yield* Integrator
              return yield* Effect.exit(integrator.prepare(request))
            }).pipe(Effect.provide(providerFor(true)))
          )
        )
        expect(Exit.isFailure(firstExit)).toBe(true)
        const secondExit = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const integrator = yield* Integrator
              return yield* Effect.exit(integrator.prepare(request))
            }).pipe(Effect.provide(providerFor(false)))
          )
        )
        expect(Exit.isSuccess(secondExit)).toBe(true)
        if (Exit.isSuccess(secondExit)) {
          expect(secondExit.value._tag).toBe("PreparedCandidate")
          expect(secondExit.value.correlation.ordinal).toBe(1)
        }
        expect(model.calls).toHaveLength(1)
      } finally {
        await closeServer(model.server)
        await rm(root, { recursive: true, force: true })
      }
    },
    120_000
  )
})
