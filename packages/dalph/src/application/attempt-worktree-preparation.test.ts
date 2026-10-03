/* eslint-disable import/no-nodejs-modules -- Focused native-process and restart fixtures need temporary paths. */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import nodeProcess from "node:process"
import { fileURLToPath } from "node:url"
import { NodeCrypto } from "@effect/platform-node"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import {
  AttemptWorktreePreparationFailure,
  nodeAttemptWorktreePreparationService,
  preparedPlannedAttemptExecutor
} from "./attempt-worktree-preparation.js"

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "dalph-420-preparation-"))
  const worktree = join(root, "worktree")
  const privateState = join(root, "private")
  await mkdir(worktree)
  const specification = makeTaskWorkSpecification({
    body: "Prepare one exact task worktree.",
    taskId: TaskId.make("issue-420"),
    title: "Prepare worktree"
  })
  const attempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("attempt:issue-420:0"),
    baseSha: GitCommitSha.make("a".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/issue-420"),
    executor: TaskExecutorLocator.make("executor:codex/dogfood"),
    runId: RunId.make("run:issue-420"),
    taskId: specification.taskId,
    taskRevision: specification.fingerprint,
    worktree: WorktreeLocator.make(worktree)
  })
  return { root, worktree, privateState, attempt, specification }
}

const commandFor = (script: string) => ({ executable: nodeProcess.execPath, args: [script] })

const prepareScript = async (worktree: string, result: "success" | "failure" | "no-receipt") => {
  const script = join(worktree, "prepare.mjs")
  await writeFile(
    script,
    `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
appendFileSync("calls", "1")
const result = ${JSON.stringify(result)}
if (result !== "no-receipt") {
  if (result === "success") mkdirSync("node_modules/.pnpm", { recursive: true })
  const report = result === "success"
    ? { _tag: "AttemptWorktreePrepared", node: "v24.20.0", worktree: process.cwd() }
    : { _tag: "AttemptWorktreePreparationFailed", stage: "node", detail: "wrong Node" }
  writeFileSync(process.env.DALPH_ATTEMPT_PREPARATION_RECEIPT,
    JSON.stringify({ ...report, token: process.env.DALPH_ATTEMPT_PREPARATION_TOKEN }) + "\\n")
  process.stdout.write(JSON.stringify(report) + "\\n")
}
if (result === "failure") process.exitCode = 1
`
  )
  return script
}

describe("exact worktree preparation before a Codex Begin", () => {
  it("prepares fresh dependencies with repository Node before entering the executor", async () => {
    const entry = await fixture()
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: entry.worktree })
      await writeFile(join(entry.worktree, "package.json"), JSON.stringify({ engines: { node: "^24.20.0" } }))
      await writeFile(join(entry.worktree, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
      await writeFile(join(entry.worktree, "mise.toml"), '[tools]\nnode = "24"\n')
      const bin = join(entry.root, "bin")
      await mkdir(bin)
      const mise = join(bin, "mise")
      await writeFile(mise, '#!/bin/sh\nif [ "$3" = node ]; then echo v24.20.0; else mkdir -p node_modules/.pnpm; fi\n')
      await chmod(mise, 0o755)
      const helper = fileURLToPath(new URL("../../../../scripts/prepare-attempt-worktree.mjs", import.meta.url))
      const preparation = nodeAttemptWorktreePreparationService(entry.privateState, commandFor(helper), {
        PATH: `${bin}:${nodeProcess.env["PATH"] ?? ""}`,
        HOME: nodeProcess.env["HOME"]
      })
      const correlation = plannedAttemptExecutorCorrelation(entry.attempt)
      const executor = PlannedAttemptExecutor.of({
        begin: () =>
          Effect.promise(async () => {
            const store = await stat(join(entry.worktree, "node_modules", ".pnpm"))
            expect(store.isDirectory()).toBe(true)
            return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          }),
        observe: () => Effect.die("unused"),
        requestSuspension: () => Effect.die("unused"),
        resume: () => Effect.die("unused")
      })
      const wrapped = await Effect.runPromise(
        preparedPlannedAttemptExecutor(executor, preparation).pipe(Effect.provide(NodeCrypto.layer))
      )
      const request = PlannedAttemptExecutorRequest.make({
        plannedAttempt: entry.attempt,
        specification: entry.specification
      })
      const report = await Effect.runPromise(wrapped.begin(request, { _tag: "InitialDelivery" }))
      expect(report._tag).toBe("ExecutorWorkExecuting")
      const records = await readFile(
        join(
          entry.privateState,
          "worktree-preparations",
          `${createHash("sha256")
            .update(JSON.stringify([entry.attempt.runId, entry.attempt.attemptId]))
            .digest("hex")}.json`
        ),
        "utf8"
      )
      expect(JSON.parse(records)).toMatchObject({ _tag: "Prepared", node: "v24.20.0" })
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })

  it("runs once in the exact worktree and reuses its durable success", async () => {
    const entry = await fixture()
    try {
      const script = await prepareScript(entry.worktree, "success")
      const command = commandFor(script)
      await Effect.runPromise(nodeAttemptWorktreePreparationService(entry.privateState, command).prepare(entry.attempt))
      await Effect.runPromise(nodeAttemptWorktreePreparationService(entry.privateState, command).prepare(entry.attempt))
      expect(await readFile(join(entry.worktree, "calls"), "utf8")).toBe("1")
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })

  it("retains a typed preparation failure without running the command again", async () => {
    const entry = await fixture()
    try {
      const script = await prepareScript(entry.worktree, "failure")
      const service = nodeAttemptWorktreePreparationService(entry.privateState, commandFor(script))
      for (let index = 0; index < 2; index += 1) {
        const error = await Effect.runPromise(Effect.flip(service.prepare(entry.attempt)))
        expect(error.stage).toBe("node")
        expect(error.detail).toBe("wrong Node")
      }
      expect(await readFile(join(entry.worktree, "calls"), "utf8")).toBe("1")
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })

  it("keeps one failed attempt local while a second worktree prepares", async () => {
    const entry = await fixture()
    try {
      const secondWorktree = join(entry.root, "worktree-b")
      await mkdir(secondWorktree)
      const secondAttempt = PlannedTaskAttempt.make({
        ...entry.attempt,
        attemptId: AttemptId.make("attempt:issue-420:1"),
        worktree: WorktreeLocator.make(secondWorktree)
      })
      const script = join(entry.root, "prepare-both.mjs")
      await writeFile(
        script,
        `
import { mkdirSync, writeFileSync } from "node:fs"
const second = process.cwd().endsWith("worktree-b")
if (second) mkdirSync("node_modules/.pnpm", { recursive: true })
const report = second
  ? { _tag: "AttemptWorktreePrepared", node: "v24.20.0", worktree: process.cwd() }
  : { _tag: "AttemptWorktreePreparationFailed", stage: "node", detail: "first worktree failed" }
writeFileSync(process.env.DALPH_ATTEMPT_PREPARATION_RECEIPT,
  JSON.stringify({ ...report, token: process.env.DALPH_ATTEMPT_PREPARATION_TOKEN }) + "\\n")
if (!second) process.exitCode = 1
`
      )
      const service = nodeAttemptWorktreePreparationService(entry.privateState, commandFor(script))
      const firstFailure = await Effect.runPromise(Effect.flip(service.prepare(entry.attempt)))
      expect(firstFailure.stage).toBe("node")
      await Effect.runPromise(service.prepare(secondAttempt))
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })

  it("keeps an intent fenced when the command returns without a terminal receipt", async () => {
    const entry = await fixture()
    try {
      const script = await prepareScript(entry.worktree, "no-receipt")
      const command = commandFor(script)
      for (let index = 0; index < 2; index += 1) {
        const error = await Effect.runPromise(
          Effect.flip(nodeAttemptWorktreePreparationService(entry.privateState, command).prepare(entry.attempt))
        )
        expect(error.stage).toBe("uncertain")
      }
      expect(await readFile(join(entry.worktree, "calls"), "utf8")).toBe("1")
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })

  it("adopts an exact completed receipt after losing the first response", async () => {
    const entry = await fixture()
    try {
      const script = await prepareScript(entry.worktree, "no-receipt")
      const command = commandFor(script)
      const directory = join(entry.privateState, "worktree-preparations")
      await mkdir(directory, { recursive: true })
      const key = createHash("sha256")
        .update(JSON.stringify([entry.attempt.runId, entry.attempt.attemptId]))
        .digest("hex")
      const digest = createHash("sha256")
        .update(JSON.stringify([command.executable, ...command.args]))
        .digest("hex")
      const path = join(directory, `${key}.json`)
      await writeFile(
        path,
        JSON.stringify({
          _tag: "Intended",
          attempt: entry.attempt,
          commandDigest: digest,
          receiptToken: "exact-token",
          startedAt: "2026-10-02T00:00:00.000Z",
          deadlineAt: "2026-10-02T00:06:00.000Z"
        })
      )
      await writeFile(
        `${path}.receipt`,
        JSON.stringify({
          _tag: "AttemptWorktreePrepared",
          node: "v24.20.0",
          token: "exact-token",
          worktree: await realpath(entry.worktree)
        })
      )
      await writeFile(`${path}.0.next`, "partial terminal write from the previous process")
      await mkdir(join(entry.worktree, "node_modules", ".pnpm"), { recursive: true })
      await Effect.runPromise(nodeAttemptWorktreePreparationService(entry.privateState, command).prepare(entry.attempt))
      expect(JSON.parse(await readFile(path, "utf8"))._tag).toBe("Prepared")
      await expect(readFile(join(entry.worktree, "calls"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })

  it("redelivers the original Begin after a crash before preparation started", async () => {
    const entry = await fixture()
    try {
      const script = await prepareScript(entry.worktree, "success")
      const preparation = nodeAttemptWorktreePreparationService(entry.privateState, commandFor(script))
      const correlation = plannedAttemptExecutorCorrelation(entry.attempt)
      const deliveries: Array<string> = []
      const executor = PlannedAttemptExecutor.of({
        begin: (_request, delivery) =>
          Effect.sync(() => {
            deliveries.push(delivery._tag)
            return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          }),
        observe: () => Effect.succeed(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })),
        requestSuspension: () => Effect.die("unused"),
        resume: () => Effect.die("unused")
      })
      const wrapped = await Effect.runPromise(
        preparedPlannedAttemptExecutor(executor, preparation).pipe(Effect.provide(NodeCrypto.layer))
      )
      const projected = await Effect.runPromise(
        wrapped.observe(correlation, { _tag: "ReconcileCommand", command: "Begin" })
      )
      expect(projected._tag).toBe("BeginNotCrossed")
      if (projected._tag !== "BeginNotCrossed") return
      const request = PlannedAttemptExecutorRequest.make({
        plannedAttempt: entry.attempt,
        specification: entry.specification
      })
      await Effect.runPromise(wrapped.begin(request, { _tag: "ReconciledDelivery", proofId: projected.proofId }))
      expect(deliveries).toEqual(["InitialDelivery"])
      expect(await readFile(join(entry.worktree, "calls"), "utf8")).toBe("1")
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })

  it("does not authorize Begin redelivery while preparation lacks a receipt", async () => {
    const entry = await fixture()
    try {
      const script = await prepareScript(entry.worktree, "no-receipt")
      const preparation = nodeAttemptWorktreePreparationService(entry.privateState, commandFor(script))
      const error = await Effect.runPromise(Effect.flip(preparation.prepare(entry.attempt)))
      expect(error.stage).toBe("uncertain")
      const correlation = plannedAttemptExecutorCorrelation(entry.attempt)
      const executor = PlannedAttemptExecutor.of({
        begin: () => Effect.die("Begin must not cross"),
        observe: () => Effect.succeed(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })),
        requestSuspension: () => Effect.die("unused"),
        resume: () => Effect.die("unused")
      })
      const wrapped = await Effect.runPromise(
        preparedPlannedAttemptExecutor(executor, preparation).pipe(Effect.provide(NodeCrypto.layer))
      )
      const projection = await Effect.runPromise(
        wrapped.observe(correlation, { _tag: "ReconcileCommand", command: "Begin" })
      )
      expect(projection._tag).toBe("Unreadable")
      expect(await readFile(join(entry.worktree, "calls"), "utf8")).toBe("1")
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })

  it("does not cross the executor Begin boundary when preparation fails", async () => {
    const entry = await fixture()
    try {
      const calls: Array<string> = []
      const correlation = plannedAttemptExecutorCorrelation(entry.attempt)
      const executor = PlannedAttemptExecutor.of({
        begin: () =>
          Effect.sync(() => {
            calls.push("begin")
            return PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
          }),
        observe: () => Effect.die("unused"),
        requestSuspension: () => Effect.die("unused"),
        resume: () => Effect.die("unused")
      })
      const prepared = await Effect.runPromise(
        preparedPlannedAttemptExecutor(executor, {
          prepare: () =>
            Effect.sync(() => calls.push("prepare")).pipe(
              Effect.andThen(
                Effect.fail(
                  new AttemptWorktreePreparationFailure({ attempt: entry.attempt, detail: "no Node", stage: "node" })
                )
              )
            ),
          inspect: () => Effect.succeed("Blocked")
        }).pipe(Effect.provide(NodeCrypto.layer))
      )
      const request = PlannedAttemptExecutorRequest.make({
        plannedAttempt: entry.attempt,
        specification: entry.specification
      })
      const error = await Effect.runPromise(Effect.flip(prepared.begin(request, { _tag: "InitialDelivery" })))
      expect(error.detail).toContain("worktree preparation node: no Node")
      expect(calls).toEqual(["prepare"])
    } finally {
      await rm(entry.root, { force: true, recursive: true })
    }
  })
})
