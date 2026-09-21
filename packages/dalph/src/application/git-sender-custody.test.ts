/* eslint-disable import/no-nodejs-modules -- fixture owns a disposable execution-substrate directory. */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GitCommand, GitSenderCustody, gitSenderTokenEnvironment, nodeGitCommandLayer } from "@dalph/orchestrator"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "vitest"
import { fileGitSenderCustodyLayer } from "./git-sender-custody.js"
import { nodeCodexProcessNativeService, type CodexProcessNativeService } from "./codex-process-native.js"

const subject = { requestId: "publication:retained-request", attemptOrdinal: 1 }
const stat = (pid: number, start: string) =>
  `${pid} (sender) S 1 ${pid} ${Array.from({ length: 16 }, () => "0").join(" ")} ${start}`

it("replacement host stops a token-owned escaped sender before releasing custody", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-sender-restart-"))
  let token = ""
  let live = true
  const signals: Array<number> = []
  const native: CodexProcessNativeService = {
    platform: "linux",
    pid: 1,
    readFile: async (path) => {
      if (path.endsWith("/status")) return "Uid:\t1000\t1000\t1000\t1000\n"
      if (path.endsWith("/stat")) return stat(22, "222")
      if (path.endsWith("/environ")) return `${gitSenderTokenEnvironment}=${token}\0`
      throw new Error(`unexpected ${path}`)
    },
    readdir: async () => (live ? ["22"] : []),
    kill: (pid) => {
      signals.push(pid)
      live = false
    },
    execFile: async () => ({ stdout: "" }),
    wait: () => Effect.void
  }
  try {
    // The first host dies after the durable pre-spawn token; no PID acknowledgement exists.
    token = await Effect.runPromise(
      Effect.flatMap(GitSenderCustody, (custody) =>
        custody.reserve(subject).pipe(Effect.andThen(custody.begin(subject)))
      ).pipe(Effect.provide(fileGitSenderCustodyLayer(directory, native)))
    )
    await Effect.runPromise(
      Effect.flatMap(GitSenderCustody, (custody) => custody.reconcile(subject)).pipe(
        Effect.provide(fileGitSenderCustodyLayer(directory, native))
      )
    )
    expect(signals).toEqual([22])
    expect(live).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("replacement host fails closed when pending sender custody is missing or unreadable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-sender-missing-"))
  try {
    const failure = await Effect.runPromise(
      Effect.flatMap(GitSenderCustody, (custody) => custody.reconcile(subject)).pipe(
        Effect.provide(fileGitSenderCustodyLayer(directory))
      )
    ).catch((error: unknown) => error)
    expect(failure).toMatchObject({ _tag: "GitSenderCustodyFailure" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("records and reconciles custody for a real bounded Git process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-sender-command-"))
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const commands = yield* GitCommand
        if (commands.runBoundedInRepository === undefined) return yield* Effect.die("bounded command missing")
        if (commands.prepareSenderCustody === undefined) return yield* Effect.die("custody preparation missing")
        yield* commands.prepareSenderCustody(subject)
        return yield* commands.runBoundedInRepository(directory, ["--version"], "2 seconds", subject)
      }).pipe(
        Effect.provide(nodeGitCommandLayer),
        Effect.provide(fileGitSenderCustodyLayer(directory)),
        Effect.provide(NodeServices.layer)
      )
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("git version")
    await Effect.runPromise(
      Effect.flatMap(GitSenderCustody, (custody) => custody.reconcile(subject)).pipe(
        Effect.provide(fileGitSenderCustodyLayer(directory))
      )
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("reopens a durable unsent reservation after numbered intent commits without inspecting processes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-sender-unsent-"))
  let inspections = 0
  const noProcessInspection: CodexProcessNativeService = {
    ...nodeCodexProcessNativeService,
    readFile: async () => {
      inspections += 1
      return Promise.reject(new Error("unsent sender has no process observation"))
    }
  }
  try {
    await Effect.runPromise(
      Effect.flatMap(GitSenderCustody, (custody) =>
        custody.reserve(subject).pipe(Effect.andThen(custody.reserve(subject)))
      ).pipe(Effect.provide(fileGitSenderCustodyLayer(directory, noProcessInspection)))
    )
    // Reopening the substrate proves Reserved: the token was never handed to spawn.
    await Effect.runPromise(
      Effect.flatMap(GitSenderCustody, (custody) => custody.reconcile(subject)).pipe(
        Effect.provide(fileGitSenderCustodyLayer(directory, noProcessInspection))
      )
    )
    expect(inspections).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
