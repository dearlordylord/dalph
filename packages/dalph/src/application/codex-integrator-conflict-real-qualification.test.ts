/* eslint-disable import/no-nodejs-modules -- this opt-in qualification owns disposable process, Git, and HTTP boundaries. */
/* eslint-disable functional/immutable-data -- the disposable fixture records its own process and endpoint observations. */
/* eslint-disable functional/no-throw-statements -- setup failures must fail the qualification rather than be hidden. */
/* eslint-disable no-restricted-globals -- the explicit opt-in is read before the real-process test is registered. */

import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { execFile as nodeExecFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  EvidenceReference,
  EvidenceDigest,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  GitCommonDirectoryTarget,
  GitCommonDirectoryLocator,
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
import {
  CodexAppServer,
  codexAppServerNodeLayer,
  makeNodeCodexProcessGroupCensusService,
  nodeCodexOwnedActivityCensusLayer
} from "./codex-app-server.js"
import { CodexServerLaunchRecord, memoryCodexAttemptStoreLayer } from "./codex-attempt-store.js"
import { nodeCodexIntegratorLayer } from "./codex-integrator.js"
import {
  CodexIntegratorConfiguration,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator
} from "./codex-integrator-private-store.js"

const execFile = promisify(nodeExecFile)
const qualificationEnabled = nodeProcess.env["DALPH_RUN_REAL_CODEX_QUALIFICATION"] === "1"

const git = async (directory: string, ...args: ReadonlyArray<string>): Promise<string> => {
  const result = await execFile("git", ["-C", directory, ...args])
  return String(result.stdout).trim()
}

const sse = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`

describe("candidate-local content conflict with the real Codex provider", () => {
  it.skipIf(!qualificationEnabled)(
    "resolves one physical conflict preserving H and C without promoting the target",
    async () => {
      const root = await realpath(await mkdtemp(nodePath.join("/tmp", "dalph-conflict-provider-")))
      const repository = nodePath.join(root, "repository")
      const candidateRoot = nodePath.join(root, "candidates")
      const codexHome = nodePath.join(root, "codex-home")
      const calls: Array<string> = []
      let candidatePath = ""
      let accepted = ""
      let mergeConflictObserved = false
      let launch: CodexServerLaunchRecord | undefined
      let passed = false
      const server = createServer((request, response) => {
        const chunks: Array<Buffer> = []
        request.on("data", (chunk: Buffer) => chunks.push(chunk))
        request.on("end", () => {
          void (async () => {
            const body = Buffer.concat(chunks).toString("utf8")
            calls.push(body)
            candidatePath ||= body.match(/Candidate worktree: ([^\\"]+)/)?.[1] ?? ""
            response.writeHead(200, { "content-type": "text/event-stream" })
            const id = `conflict-response-${calls.length}`
            response.write(sse({ type: "response.created", response: { id } }))
            if (calls.length <= 2) {
              const cmd =
                calls.length === 1
                  ? `cat AGENTS.md; git show HEAD:behavior.txt; git show ${accepted}:behavior.txt; git merge --no-ff --no-commit ${accepted}`
                  : "git diff --name-only --diff-filter=U; printf 'target=enabled\\naccepted=enabled\\n' > behavior.txt; node check.cjs && git add behavior.txt && git commit -m resolved-conflict && git rev-parse HEAD"
              response.write(
                sse({
                  type: "response.output_item.done",
                  item: {
                    type: "function_call",
                    call_id: `conflict-tool-${calls.length}`,
                    name: "exec_command",
                    arguments: JSON.stringify({ cmd, workdir: candidatePath, yield_time_ms: 10000 })
                  }
                })
              )
            } else {
              mergeConflictObserved = body.includes("CONFLICT (content)") && body.includes("behavior.txt")
              const candidate = await git(candidatePath, "rev-parse", "HEAD")
              response.write(
                sse({
                  type: "response.output_item.done",
                  item: {
                    type: "message",
                    role: "assistant",
                    id: "conflict-result",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify({ version: 1, outcome: "PreparedCandidate", candidate })
                      }
                    ]
                  }
                })
              )
            }
            response.write(
              sse({
                type: "response.completed",
                response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }
              })
            )
            response.end()
          })().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error(String(error))))
        })
      })
      try {
        await mkdir(repository)
        await mkdir(candidateRoot)
        await mkdir(codexHome)
        await git(repository, "init", "-q", "-b", "master")
        await git(repository, "config", "user.email", "conflict@example.invalid")
        await git(repository, "config", "user.name", "Conflict control")
        await writeFile(nodePath.join(repository, "behavior.txt"), "target=disabled\naccepted=disabled\n")
        await writeFile(
          nodePath.join(repository, "AGENTS.md"),
          "Preserve target=enabled from H and accepted=enabled from C. Resolve behavior.txt and run node check.cjs before committing.\n"
        )
        await writeFile(
          nodePath.join(repository, "check.cjs"),
          "const assert = require('node:assert/strict'); assert.equal(require('node:fs').readFileSync('behavior.txt','utf8'), 'target=enabled\\naccepted=enabled\\n');\n"
        )
        await git(repository, "add", ".")
        await git(repository, "commit", "-qm", "base")
        const base = GitCommitSha.make(await git(repository, "rev-parse", "HEAD"))
        await git(repository, "checkout", "-qb", "accepted")
        await writeFile(nodePath.join(repository, "behavior.txt"), "target=disabled\naccepted=enabled\n")
        await git(repository, "commit", "-qam", "accepted behavior")
        accepted = await git(repository, "rev-parse", "HEAD")
        await git(repository, "checkout", "-q", "master")
        await writeFile(nodePath.join(repository, "behavior.txt"), "target=enabled\naccepted=disabled\n")
        await git(repository, "commit", "-qam", "target behavior")
        const head = GitCommitSha.make(await git(repository, "rev-parse", "HEAD"))
        const commonDirectory = await realpath(nodePath.join(repository, ".git"))
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
        const address = server.address()
        if (address === null || typeof address === "string") throw new Error("endpoint missing")
        await writeFile(
          nodePath.join(codexHome, "config.toml"),
          [
            "features.plugins = false",
            'model_provider = "fixture"',
            'model = "fixture"',
            'approval_policy = "never"',
            'sandbox_mode = "danger-full-access"',
            "[model_providers.fixture]",
            'name = "fixture"',
            `base_url = "http://127.0.0.1:${address.port}/v1"`,
            'wire_api = "responses"',
            "request_max_retries = 0",
            "stream_max_retries = 0"
          ].join("\n")
        )
        const config = CodexIntegratorConfiguration.make({
          candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make(candidateRoot),
          commonDirectory: GitCommonDirectoryLocator.make(commonDirectory),
          privateStoreLocator: IntegratorPrivateStoreLocator.make(nodePath.join(root, "private-store.json")),
          repository: GitRepositoryLocator.make(repository)
        })
        const session = IntegratorSessionCorrelation.make({
          acceptedResult: AcceptedResult.make({
            commit: GitCommitSha.make(accepted),
            evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("0".repeat(64)) })
          }),
          candidateResource: IntegratorCandidateResourceLocator.make("qualification-candidate"),
          expectedTargetHead: head,
          integrationTarget: IntegrationTarget.make({
            repository: GitRepositoryLocator.make(repository),
            ref: IntegrationTargetRef.make("refs/heads/master")
          }),
          plannedAttempt: PlannedTaskAttempt.make({
            attemptId: AttemptId.make("qualification-attempt"),
            baseSha: base,
            branch: TaskBranchRef.make("refs/heads/qualification"),
            executor: TaskExecutorLocator.make("qualification-executor"),
            runId: RunId.make("qualification-run"),
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
        const providerFor = () => {
          const app = codexAppServerNodeLayer({
            executable: nodePath.resolve("node_modules/.bin/codex"),
            environment: { CODEX_HOME: codexHome }
          }).pipe(Layer.provide(memoryCodexAttemptStoreLayer()), Layer.provide(NodeServices.layer))
          const ownership = productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(commonDirectory)).pipe(
            Layer.provide(NodeFileSystem.layer)
          )
          const integrator = nodeCodexIntegratorLayer(config)
            .pipe(Layer.provide(nodeCodexOwnedActivityCensusLayer))
            .pipe(Layer.provideMerge(app))
            .pipe(Layer.provide(NodeFileSystem.layer))
            .pipe(Layer.provide(nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer))))
            .pipe(Layer.provide(ownership))
          return integrator
        }
        const result = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const integrator = yield* Integrator
              const app = yield* CodexAppServer
              try {
                return yield* integrator.prepare(request)
              } finally {
                if (app.serverPid !== undefined)
                  launch = CodexServerLaunchRecord.make({
                    command: [nodePath.resolve("node_modules/.bin/codex"), "app-server"],
                    incarnation: app.incarnation,
                    pid: app.serverPid,
                    phase: "Live"
                  })
              }
            }).pipe(Effect.provide(providerFor()))
          )
        )
        expect(result._tag).toBe("PreparedCandidate")
        if (result._tag !== "PreparedCandidate") throw new Error(result.detail)
        expect(calls).toHaveLength(3)
        expect(calls[0]).toContain("You own content-conflict resolution")
        expect(mergeConflictObserved).toBe(true)
        expect(await git(repository, "rev-list", "--parents", "-n", "1", result.candidateText)).toBe(
          `${result.candidateText} ${head} ${accepted}`
        )
        expect(await git(repository, "rev-parse", "refs/heads/master")).toBe(head)
        expect(await git(repository, "rev-parse", "refs/heads/accepted")).toBe(accepted)
        expect(await readFile(nodePath.join(candidatePath, "behavior.txt"), "utf8")).toBe(
          "target=enabled\naccepted=enabled\n"
        )
        await execFile(nodeProcess.execPath, ["check.cjs"], { cwd: candidatePath })
        passed = true
      } finally {
        if (launch !== undefined) {
          const stopped = await Effect.runPromise(makeNodeCodexProcessGroupCensusService().observe(launch))
          await writeFile(
            nodeProcess.env["DALPH_CONFLICT_CUSTODY_EVIDENCE"] ?? "/tmp/dalph-conflict-custody.json",
            JSON.stringify({ root, launch, stopped, calls: calls.length, mergeConflictObserved, passed }, null, 2)
          )
          expect(stopped._tag).toBe("Absent")
        }
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
        if (passed) await rm(root, { recursive: true, force: true })
      }
    },
    120000
  )
})
