/* eslint-disable import/no-nodejs-modules -- fixture owns a disposable execution-substrate directory. */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  GitCommand,
  GitCommandCustodySubject,
  GitSenderCustody,
  GitSenderProcessId,
  gitSenderTokenEnvironment,
  nodeGitCommandLayer,
  RemotePublicationAttemptOrdinal,
  RemotePublicationRequestId
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { NodeServices } from "@effect/platform-node"
import { expect, it } from "vitest"
import { fileGitSenderCustodyLayer } from "./git-sender-custody.js"
import { nodeCodexProcessNativeService, type CodexProcessNativeService } from "./codex-process-native.js"

const subject = GitCommandCustodySubject.make({
  requestId: RemotePublicationRequestId.make("publication:retained-request"),
  attemptOrdinal: RemotePublicationAttemptOrdinal.make(1)
})
const stat = (pid: number, start: string) =>
  `${pid} (sender) S 1 ${pid} ${Array.from({ length: 16 }, () => "0").join(" ")} ${start}`

const prepareSpawnedRecord = async (directory: string, native: CodexProcessNativeService) => {
  const token = await Effect.runPromise(
    Effect.flatMap(GitSenderCustody, (custody) =>
      custody.reserve(subject).pipe(Effect.andThen(custody.begin(subject)))
    ).pipe(Effect.provide(fileGitSenderCustodyLayer(directory, native)))
  )
  const custodyDirectory = join(directory, "dalph", "git-senders")
  const [entry] = await readdir(custodyDirectory)
  if (entry === undefined) throw new Error("sender custody record missing")
  const path = join(custodyDirectory, entry)
  await writeFile(
    path,
    JSON.stringify({ subject, token, identity: { pid: 23, startIdentity: "other" }, phase: "Spawned" })
  )
}

it("decodes and round-trips only exact publication custody identities", () => {
  const encoded = Schema.encodeUnknownSync(GitCommandCustodySubject)(subject)
  expect(Schema.decodeUnknownSync(GitCommandCustodySubject)(encoded)).toEqual(subject)
  expect(() => Schema.decodeUnknownSync(GitCommandCustodySubject)({ ...encoded, requestId: "" })).toThrow()
  expect(() => Schema.decodeUnknownSync(GitCommandCustodySubject)({ ...encoded, attemptOrdinal: 0 })).toThrow()
  expect(() => Schema.decodeUnknownSync(GitCommandCustodySubject)({ ...encoded, attemptOrdinal: 1.5 })).toThrow()
})

it("accepts only positive integer Git sender process identities", () => {
  expect(Schema.decodeUnknownSync(GitSenderProcessId)(37)).toBe(37)
  expect(() => Schema.decodeUnknownSync(GitSenderProcessId)(0)).toThrow()
  expect(() => Schema.decodeUnknownSync(GitSenderProcessId)(-1)).toThrow()
  expect(() => Schema.decodeUnknownSync(GitSenderProcessId)(1.5)).toThrow()
})

it("fails closed when durable process custody has an invalid PID or start identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-sender-invalid-identity-"))
  try {
    await Effect.runPromise(
      Effect.flatMap(GitSenderCustody, (custody) => custody.reserve(subject)).pipe(
        Effect.provide(fileGitSenderCustodyLayer(directory))
      )
    )
    const custodyDirectory = join(directory, "dalph", "git-senders")
    const [entry] = await readdir(custodyDirectory)
    if (entry === undefined) throw new Error("sender custody record missing")
    const path = join(custodyDirectory, entry)
    const reserved: unknown = JSON.parse(await readFile(path, "utf8"))
    if (typeof reserved !== "object" || reserved === null || Array.isArray(reserved)) {
      throw new Error("sender custody record is not an object")
    }
    for (const identity of [
      { pid: 0, startIdentity: "linux:123" },
      { pid: 37, startIdentity: "" }
    ]) {
      await writeFile(path, JSON.stringify({ ...reserved, identity, phase: "Spawned" }))
      const failure = await Effect.runPromise(
        Effect.flatMap(GitSenderCustody, (custody) => custody.reconcile(subject)).pipe(
          Effect.provide(fileGitSenderCustodyLayer(directory))
        )
      ).catch((error: unknown) => error)
      expect(failure).toMatchObject({ _tag: "GitSenderCustodyFailure" })
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

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

it("fails closed for unavailable and ambiguous process census evidence", async () => {
  const scenarios: ReadonlyArray<{
    readonly name: string
    readonly native: (base: CodexProcessNativeService) => CodexProcessNativeService
    readonly succeeds?: boolean
  }> = [
    { name: "non-linux host", native: (base) => ({ ...base, platform: "darwin" }) },
    { name: "missing owner uid", native: (base) => ({ ...base, readFile: async () => "Name:\tself\n" }) },
    {
      name: "missing child uid",
      native: (base) => ({
        ...base,
        readFile: async (path) => (path === "/proc/self/status" ? "Uid:\t1000\t1000\t1000\t1000\n" : "Name:\tchild\n"),
        readdir: async () => ["22"]
      })
    },
    {
      name: "malformed child stat",
      native: (base) => ({
        ...base,
        readFile: async (path) => (path.endsWith("/status") ? "Uid:\t1000\t1000\t1000\t1000\n" : "malformed"),
        readdir: async () => ["22"]
      })
    },
    {
      name: "zombie child",
      native: (base) => ({
        ...base,
        readFile: async (path) => {
          if (path.endsWith("/status")) return "Uid:\t1000\t1000\t1000\t1000\n"
          if (path.endsWith("/stat")) return stat(22, "222").replace(" S ", " Z ")
          return ""
        },
        readdir: async () => ["22"]
      }),
      succeeds: true
    },
    {
      name: "unowned child",
      native: (base) => ({
        ...base,
        readFile: async (path) =>
          path === "/proc/self/status" || path.endsWith("/status")
            ? `Uid:\t${path === "/proc/self/status" ? "1000" : "2000"}\t1000\t1000\t1000\n`
            : stat(22, "222"),
        readdir: async () => ["22"]
      }),
      succeeds: true
    },
    {
      name: "disappeared child",
      native: (base) => ({
        ...base,
        readFile: async (path) => {
          if (path === "/proc/self/status") return "Uid:\t1000\t1000\t1000\t1000\n"
          if (path.endsWith("/status")) return "Uid:\t1000\t1000\t1000\t1000\n"
          const error = Object.assign(new Error("gone"), { code: "ENOENT" })
          throw error
        },
        readdir: async () => ["22"]
      }),
      succeeds: true
    }
  ]
  for (const scenario of scenarios) {
    const directory = await mkdtemp(join(tmpdir(), `dalph-sender-census-${scenario.name.replaceAll(" ", "-")}-`))
    try {
      const native = scenario.native(nodeCodexProcessNativeService)
      await prepareSpawnedRecord(directory, native)
      const result = await Effect.runPromise(
        Effect.flatMap(GitSenderCustody, (custody) => custody.reconcile(subject)).pipe(
          Effect.provide(fileGitSenderCustodyLayer(directory, native))
        )
      ).catch((error: unknown) => error)
      if (scenario.succeeds === true) expect(result).toBeUndefined()
      else expect(result).toMatchObject({ _tag: "GitSenderCustodyFailure" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
