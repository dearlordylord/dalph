/* eslint-disable import/no-nodejs-modules -- this opt-in qualification owns disposable process, Git, and HTTP boundaries. */
/* eslint-disable functional/immutable-data -- the disposable fixture records its own process and endpoint observations. */
/* eslint-disable functional/no-throw-statements -- setup failures must fail the qualification rather than be hidden. */
/* eslint-disable no-restricted-globals -- the explicit opt-in is read before the real-process test is registered. */

import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { execFile as nodeExecFile } from "node:child_process"
import { createServer } from "node:http"
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
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
  it.skipIf(!qualificationEnabled).each([
    { name: "resolves one physical conflict preserving H and C without promoting the target", documentation: false },
    { name: "repairs one moved historical link after a clean merge with the live model", documentation: true }
  ])(
    "$name",
    async ({ documentation }) => {
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
      let documentationChecks: Array<number> = []
      let runtimeChecks: Array<number> = []
      let targetHead = ""
      let preparedCandidate = ""
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
        const executable = documentation
          ? nodeProcess.env["DALPH_LINK_REPAIR_CODEX_BIN"]
          : nodePath.resolve("node_modules/.bin/codex")
        if (executable === undefined)
          throw new Error("live repair requires DALPH_LINK_REPAIR_CODEX_BIN (Codex 0.162.1)")
        if (documentation)
          expect(String((await execFile(executable, ["--version"])).stdout).trim()).toBe("codex-cli 0.162.1")
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
        if (documentation) {
          await mkdir(nodePath.join(repository, "docs", "evidence"), { recursive: true })
          await writeFile(nodePath.join(repository, "docs", "target.md"), "# Existing target\n")
          await writeFile(
            nodePath.join(repository, "docs", "evidence", "historical.md"),
            "Historical account: [existing target](../target.md#existing-target).\n"
          )
          await writeFile(nodePath.join(repository, "raw-evidence.txt"), "immutable evidence\n")
          await writeFile(nodePath.join(repository, "docs/evidence/sealed.md"), "Sealed evidence.\n")
          await writeFile(
            nodePath.join(repository, "manifest.json"),
            JSON.stringify({
              artifact: "raw-evidence.txt",
              document: "docs/evidence/sealed.md",
              documentSha256: "76285d3ba3078d4de2f05afde9bf9669f85983dc7cfbf25424d67dadb825bda1",
              sha256: "aeff868b6d4b87b297f28da65e4b3e5d838646ca2149123e17fc794d6a023fb5"
            })
          )
          await writeFile(
            nodePath.join(repository, "package.json"),
            JSON.stringify({ scripts: { "check:docs": "node docs-check.cjs", "check:runtime": "node check.cjs" } })
          )
          await writeFile(
            nodePath.join(repository, "docs-check.cjs"),
            `const fs=require('node:fs'),path=require('node:path'); const file='docs/evidence/moved/historical.md'; const text=fs.readFileSync(file,'utf8'); const dest=text.match(/\\]\\(([^)]+)\\)/)[1]; const exit=fs.existsSync(path.resolve(path.dirname(file),dest.split('#')[0])) && dest.split('#')[1]==='existing-target' ? 0 : 2; fs.appendFileSync(${JSON.stringify(nodePath.join(root, "docs-checks.jsonl"))},JSON.stringify({exit,dest})+'\\n'); if (exit !== 0) { console.error(file+': broken relative local Markdown link '+dest); process.exit(2); } \n`
          )
          await writeFile(
            nodePath.join(repository, "AGENTS.md"),
            "Required checks: pnpm check:docs and pnpm check:runtime. Preserve both enabled behaviors. Historical document moved one directory deeper in C; intended target is docs/target.md. Only lexical link destination repair is accepted. raw-evidence.txt, docs/evidence/sealed.md and manifest.json are immutable. Do not edit checks.\n"
          )
        }
        await git(repository, "add", ".")
        await git(repository, "commit", "-qm", "base")
        const base = GitCommitSha.make(await git(repository, "rev-parse", "HEAD"))
        await git(repository, "checkout", "-qb", "accepted")
        await writeFile(nodePath.join(repository, "behavior.txt"), "target=disabled\naccepted=enabled\n")
        if (documentation) {
          await mkdir(nodePath.join(repository, "docs", "evidence", "moved"))
          await git(repository, "mv", "docs/evidence/historical.md", "docs/evidence/moved/historical.md")
          // Separate files make this a clean merge; the runtime check still proves both sides.
          await writeFile(nodePath.join(repository, "accepted.txt"), "accepted=enabled\n")
          await writeFile(nodePath.join(repository, "behavior.txt"), "target=disabled\naccepted=disabled\n")
          await writeFile(
            nodePath.join(repository, "check.cjs"),
            `const a=require('node:assert/strict'),f=require('node:fs'); a.equal(f.readFileSync('behavior.txt','utf8'),'target=enabled\\naccepted=disabled\\n'); a.equal(f.readFileSync('accepted.txt','utf8'),'accepted=enabled\\n'); f.appendFileSync(${JSON.stringify(nodePath.join(root, "runtime-checks.jsonl"))},'0\\n');\n`
          )
          await git(repository, "add", ".")
        }
        await git(repository, "commit", "-qam", "accepted behavior")
        accepted = await git(repository, "rev-parse", "HEAD")
        await git(repository, "checkout", "-q", "master")
        await writeFile(nodePath.join(repository, "behavior.txt"), "target=enabled\naccepted=disabled\n")
        await git(repository, "commit", "-qam", "target behavior")
        const head = GitCommitSha.make(await git(repository, "rev-parse", "HEAD"))
        targetHead = head
        const cleanMergeTree = documentation ? await git(repository, "merge-tree", "--write-tree", head, accepted) : ""
        if (documentation) expect(cleanMergeTree).toMatch(/^[0-9a-f]{40}$/)
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
        if (documentation) {
          const sourceHome = nodeProcess.env["CODEX_HOME"]
          if (sourceHome === undefined) throw new Error("live repair requires authenticated CODEX_HOME")
          await copyFile(nodePath.join(sourceHome, "auth.json"), nodePath.join(codexHome, "auth.json"))
          await writeFile(
            nodePath.join(codexHome, "config.toml"),
            'features.plugins = false\nmodel = "gpt-6.1-sol"\nmodel_reasoning_effort = "low"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n'
          )
        }
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
          const app = codexAppServerNodeLayer({ executable, environment: { CODEX_HOME: codexHome } }).pipe(
            Layer.provide(memoryCodexAttemptStoreLayer()),
            Layer.provide(NodeServices.layer)
          )
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
                    command: [executable, "app-server"],
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
        preparedCandidate = result.candidateText
        if (!documentation) {
          expect(calls).toHaveLength(3)
          expect(calls[0]).toContain("You own content-conflict resolution")
          expect(mergeConflictObserved).toBe(true)
        }
        expect(await git(repository, "rev-list", "--parents", "-n", "1", result.candidateText)).toBe(
          `${result.candidateText} ${head} ${accepted}`
        )
        expect(await git(repository, "rev-parse", "refs/heads/master")).toBe(head)
        expect(await git(repository, "rev-parse", "refs/heads/accepted")).toBe(accepted)
        candidatePath = await git(repository, "worktree", "list", "--porcelain").then(
          (text) =>
            text
              .split("\n")
              .find((line) => line.startsWith(`worktree ${candidateRoot}/`))
              ?.slice(9) ?? candidatePath
        )
        expect(await readFile(nodePath.join(candidatePath, "behavior.txt"), "utf8")).toBe(
          documentation ? "target=enabled\naccepted=disabled\n" : "target=enabled\naccepted=enabled\n"
        )
        if (documentation) {
          runtimeChecks = (await readFile(nodePath.join(root, "runtime-checks.jsonl"), "utf8"))
            .trim()
            .split("\n")
            .map(Number)
          expect(runtimeChecks.length).toBeGreaterThan(0)
          expect(runtimeChecks.every((exit) => exit === 0)).toBe(true)
        }
        await execFile(nodeProcess.execPath, ["check.cjs"], { cwd: candidatePath })
        if (documentation) {
          expect(await git(repository, "diff", "--name-only", cleanMergeTree, result.candidateText)).toBe(
            "docs/evidence/moved/historical.md"
          )
          expect(await readFile(nodePath.join(candidatePath, "docs/evidence/moved/historical.md"), "utf8")).toBe(
            "Historical account: [existing target](../../target.md#existing-target).\n"
          )
          for (const file of [
            "behavior.txt",
            "accepted.txt",
            "check.cjs",
            "docs-check.cjs",
            "package.json",
            "raw-evidence.txt",
            "manifest.json",
            "docs/evidence/sealed.md",
            "docs/target.md"
          ]) {
            const owner = file === "behavior.txt" ? head : accepted
            expect(await git(candidatePath, "rev-parse", `HEAD:${file}`)).toBe(
              await git(repository, "rev-parse", `${owner}:${file}`)
            )
          }
          documentationChecks = (await readFile(nodePath.join(root, "docs-checks.jsonl"), "utf8"))
            .trim()
            .split("\n")
            .map((line) => (JSON.parse(line) as { exit: number }).exit)
          expect(documentationChecks[0]).toBe(2)
          expect(documentationChecks.at(-1)).toBe(0)
          await execFile("pnpm", ["check:docs"], { cwd: candidatePath })
        }
        passed = true
      } finally {
        if (launch !== undefined) {
          const stopped = await Effect.runPromise(makeNodeCodexProcessGroupCensusService().observe(launch))
          await writeFile(
            nodeProcess.env["DALPH_CONFLICT_CUSTODY_EVIDENCE"] ?? "/tmp/dalph-conflict-custody.json",
            JSON.stringify(
              {
                root,
                launch,
                stopped,
                calls: calls.length,
                documentation,
                documentationChecks,
                runtimeChecks,
                accepted,
                targetHead,
                preparedCandidate,
                candidatePath,
                mergeConflictObserved,
                passed
              },
              null,
              2
            )
          )
          expect(stopped._tag).toBe("Absent")
        }
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
        if (passed) await rm(root, { recursive: true, force: true })
      }
    },
    240000
  )
})
