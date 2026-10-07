/* eslint-disable import/no-nodejs-modules -- these tests exercise the execution-substrate public boundary. */
import nodeProcess from "node:process"
import { spawn } from "node:child_process"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Effect, Exit, FileSystem, Layer, Option, Path, Schema, Stream } from "effect"
import { expect } from "vitest"
import {
  CodexAppServer,
  CodexAppServerFailure,
  type CodexBackgroundTerminal,
  CodexOwnedActivityCensus,
  CodexProcessStartIdentity,
  CodexThreadWorkingDirectory,
  controlledCodexAppServerLayer,
  controlledCodexOwnedActivityCensusLayer,
  codexAppServerNodeLayer,
  incarnationWithProcessIdentity,
  makeNodeCodexProcessGroupCensusService,
  makeNodeCodexProcessOwnershipService,
  makeNodeCodexOwnedActivityCensusService,
  stopOwnedAppServer,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection,
  type CodexOwnedProcessIdentity,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import {
  CodexAttemptStore,
  CodexAttemptStoreFailure,
  CodexThreadId,
  CodexTurnId,
  CodexServerIncarnation,
  CodexServerLaunchRecord,
  type CodexAttemptStoreService,
  memoryCodexAttemptStoreLayer
} from "./codex-attempt-store.js"
import { nodeCodexProcessNativeService } from "./codex-process-native.js"
import { isolatedCodexProcessNativeService } from "../../test-support/isolated-codex-process-native.js"

import { resolveCodexProviderHome } from "./codex-provider-home.js"
import { CodexServerStartupRecord } from "./codex-server-startup-record.js"

const standaloneNodeCodexOwnedActivityCensusLayer = Layer.succeed(
  CodexOwnedActivityCensus,
  makeNodeCodexOwnedActivityCensusService()
)

const thread = (
  status: CodexThreadSnapshot["status"],
  turns: ReadonlyArray<CodexTurnSnapshot>,
  id = "public-thread",
  cwd = "/public/worktree"
): CodexThreadSnapshot => ({ id: CodexThreadId.make(id), cwd: CodexThreadWorkingDirectory.make(cwd), status, turns })

const turn = (id: string, status: CodexTurnSnapshot["status"]): CodexTurnSnapshot => ({
  id: CodexTurnId.make(id),
  status,
  items: []
})

const terminal = (osPid?: number | null): CodexBackgroundTerminal => ({
  processId: "terminal-process",
  itemId: "terminal-item",
  command: "sleep 1",
  cwd: "/public/worktree",
  ...(osPid === undefined ? {} : { osPid })
})

type FakeLinuxProcessStat =
  | { readonly _tag: "Read"; readonly text: string }
  | { readonly _tag: "Error"; readonly error: unknown }

const linuxProcessStat = (pid: number, parentPid: number, processGroupId: number, startIdentity: string): string =>
  `${pid} (fixture-codex) ${[
    "S",
    String(parentPid),
    String(processGroupId),
    ...Array.from({ length: 16 }, () => "0"),
    startIdentity
  ].join(" ")}`

const withFakeLinuxProc = <A, E>(
  entries: ReadonlyArray<string>,
  stats: ReadonlyMap<number, FakeLinuxProcessStat>,
  effect: Effect.Effect<A, E, CodexOwnedActivityCensus>,
  kill: typeof nodeProcess.kill = nodeCodexProcessNativeService.kill as typeof nodeProcess.kill
): Effect.Effect<A, E> => {
  const readFile = async (path: string): Promise<string> => {
    if (path.endsWith("/cmdline")) return "fixture-codex\u0000"
    const match = /\/proc\/([0-9]+)\/stat$/.exec(path)
    const pid = match === null ? -1 : Number(match[1])
    const result = stats.get(pid)
    if (result === undefined) {
      const error = Object.assign(new Error(`missing process ${pid}`), { code: "ENOENT" })
      throw error
    }
    if (result._tag === "Error") throw result.error
    return result.text
  }
  const native = { ...nodeCodexProcessNativeService, kill, readFile, readdir: async () => entries }
  return effect.pipe(
    Effect.provide(Layer.succeed(CodexOwnedActivityCensus, makeNodeCodexOwnedActivityCensusService(native)))
  )
}

type FakeProcFile =
  | { readonly _tag: "Read"; readonly text: string }
  | { readonly _tag: "Error"; readonly error: unknown }

const withFakeProcFiles = <A, E>(
  entries: ReadonlyArray<string>,
  files: ReadonlyMap<string, FakeProcFile>,
  use: (native: typeof nodeCodexProcessNativeService) => Effect.Effect<A, E>
): Effect.Effect<A, E> => {
  const readFile = async (path: string): Promise<string> => {
    if (path === `/proc/${nodeProcess.pid}/stat`) return nodeCodexProcessNativeService.readFile(path)
    const result = files.get(path)
    if (result === undefined) {
      const error = Object.assign(new Error(`missing process file ${path}`), { code: "ENOENT" })
      throw error
    }
    if (result._tag === "Error") throw result.error
    return result.text
  }
  return use({ ...nodeCodexProcessNativeService, readFile, readdir: async () => entries })
}

const withFakeLeaseProc = <A, E>(
  stats: ReadonlyArray<FakeProcFile>,
  killError: unknown,
  use: (native: typeof nodeCodexProcessNativeService, switchToUnsupportedPlatform: () => void) => Effect.Effect<A, E>
): Effect.Effect<A, E> => {
  let readCount = 0
  let platform: NodeJS.Platform = "linux"
  const readFile = async (path: string): Promise<string> => {
    if (!path.endsWith(`/proc/${nodeProcess.pid}/stat`)) {
      const error = Object.assign(new Error("unexpected lease process file"), { code: "ENOENT" })
      throw error
    }
    const result = stats[Math.min(readCount++, stats.length - 1)]
    if (result === undefined) {
      const error = Object.assign(new Error("missing lease process stat"), { code: "ENOENT" })
      throw error
    }
    if (result._tag === "Error") throw result.error
    return result.text
  }
  const kill = () => {
    if (killError !== undefined) {
      // eslint-disable-next-line functional/no-throw-statements -- the controlled kill fixture emulates a native signal failure.
      throw killError
    }
  }
  return use(
    {
      ...nodeCodexProcessNativeService,
      get platform() {
        return platform
      },
      readFile,
      kill
    },
    () => void (platform = "darwin")
  )
}

const controlledProcessGroupNative = () => {
  let facts:
    | {
        readonly command: ReadonlyArray<string>
        readonly pid: number
        readonly processGroupId: number
        readonly startIdentity: string
      }
    | undefined
  let signaled = false
  const readFile = async (path: string): Promise<string> => {
    if (facts === undefined || !path.startsWith(`/proc/${facts.pid}/`)) {
      return nodeCodexProcessNativeService.readFile(path)
    }
    if (path.endsWith("/cmdline")) return `${facts.command.join("\u0000")}\u0000`
    if (path.endsWith("/stat")) {
      if (signaled) {
        const error = Object.assign(new Error("gone"), { code: "ESRCH" })
        throw error
      }
      return linuxProcessStat(facts.pid, 0, facts.processGroupId, facts.startIdentity)
    }
    const error = Object.assign(new Error(`missing process file ${path}`), { code: "ENOENT" })
    throw error
  }
  const kill = (pid: number, signal: number | NodeJS.Signals) => {
    if (facts === undefined || Math.abs(pid) !== facts.pid) return nodeCodexProcessNativeService.kill(pid, signal)
    if (signal === 0 && signaled) {
      const error = Object.assign(new Error("gone"), { code: "ESRCH" })
      // eslint-disable-next-line functional/no-throw-statements -- the controlled kill fixture emulates a vanished process.
      throw error
    }
    if (signal !== 0) signaled = true
  }
  return {
    native: {
      ...nodeCodexProcessNativeService,
      readFile,
      readdir: async (directory: string) =>
        directory !== "/proc"
          ? nodeCodexProcessNativeService.readdir(directory)
          : facts === undefined || signaled
            ? []
            : [String(facts.pid)],
      kill
    },
    configure: (next: NonNullable<typeof facts>) => void (facts = next)
  }
}

type FakeLaunchObservation = {
  readonly commandLine?: string
  readonly stat?: string
  readonly killError?: unknown
  readonly platform?: string
}

const withFakeLaunchObservation = <A, E>(
  observation: FakeLaunchObservation,
  use: (native: typeof nodeCodexProcessNativeService) => Effect.Effect<A, E>
): Effect.Effect<A, E> => {
  const readFile = async (path: string): Promise<string> => {
    const value = path.endsWith("/cmdline") ? observation.commandLine : observation.stat
    if (value === undefined) {
      const error = Object.assign(new Error(`missing process file ${path}`), { code: "ENOENT" })
      throw error
    }
    return value
  }
  const kill = () => {
    if (observation.killError !== undefined) {
      // eslint-disable-next-line functional/no-throw-statements -- the controlled kill fixture emulates a native signal failure.
      throw observation.killError
    }
  }
  return use({
    ...nodeCodexProcessNativeService,
    platform: (observation.platform ?? "linux") as NodeJS.Platform,
    readFile,
    kill
  })
}

const discoveryFixture = String.raw`#!/usr/bin/env node
if (process.env.DALPH_DISCOVERY_READY === "1") process.stderr.write("ready\n")
let buffer = ""
const write = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n")
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() === "") continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    if (message.method === "initialize") {
      write(message.id, { userAgent: "fixture", codexHome: process.env.CODEX_HOME ?? "/tmp/fixture", platformFamily: "unix", platformOs: "linux" })
    } else if (message.method === "thread/start") {
      write(message.id, { thread: { id: "discovery-thread", cwd: message.params.cwd, status: "idle", turns: [] } })
    } else {
      write(message.id, {})
    }
  }
})
setInterval(() => {}, 1000)
`

const resistantWriterFixture = String.raw`#!/usr/bin/env node
const fs = require("node:fs")
const { spawn } = require("node:child_process")
const child = spawn(process.execPath, ["-e",
  'process.on("SIGTERM", () => {}); setInterval(() => require("node:fs").appendFileSync(process.argv[1], "write\\n"), 5)',
  process.argv[4]
], { stdio: "ignore" })
fs.writeFileSync(process.argv[3], String(child.pid))
setInterval(() => {}, 1000)
`

it.effect("escalates a real resistant writer and recovers after its leader exits before close", () =>
  Effect.forEach([false, true], (leaderAlreadyExited) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-resistant-writer-" })
        const executable = path.join(root, "fixture-codex")
        const pidFile = path.join(root, "writer.pid")
        const outputFile = path.join(root, "writer.txt")
        yield* fileSystem.writeFileString(executable, resistantWriterFixture)
        yield* fileSystem.chmod(executable, 0o755)
        const token = CodexServerIncarnation.make("resistant-writer-fixture")
        const child = spawn(executable, ["app-server", pidFile, outputFile], {
          detached: true,
          env: { ...nodeProcess.env, DALPH_CODEX_SERVER_INCARNATION: token },
          stdio: "ignore"
        })
        const pid = child.pid
        if (pid === undefined) return yield* Effect.die("fixture did not spawn")
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            try {
              nodeProcess.kill(-pid, "SIGKILL")
            } catch {
              // The tested containment should already be absent.
            }
          })
        )
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (yield* fileSystem.exists(outputFile)) break
          yield* nodeCodexProcessNativeService.wait(10)
        }
        expect(yield* fileSystem.exists(outputFile)).toBe(true)
        const incarnation = yield* Effect.promise(() => incarnationWithProcessIdentity(token, pid))
        if (incarnation === undefined) return yield* Effect.die("fixture has no process identity")
        const launch = CodexServerLaunchRecord.make({
          command: [executable, "app-server", pidFile, outputFile],
          incarnation,
          phase: "Live",
          pid
        })
        const signals: Array<{ readonly pid: number; readonly signal: number | NodeJS.Signals }> = []
        const native = {
          ...nodeCodexProcessNativeService,
          kill: (target: number, signal: number | NodeJS.Signals) => {
            signals.push({ pid: target, signal })
            return nodeCodexProcessNativeService.kill(target, signal)
          }
        }
        const census = makeNodeCodexProcessGroupCensusService(native)
        const ownership = makeNodeCodexProcessOwnershipService(census, native)
        if (leaderAlreadyExited) {
          nodeProcess.kill(-pid, "SIGTERM")
          for (let attempt = 0; attempt < 100; attempt += 1) {
            if ((yield* ownership.observe(launch))._tag === "Absent") break
            yield* nodeCodexProcessNativeService.wait(10)
          }
          expect((yield* ownership.observe(launch))._tag).toBe("Absent")
          expect((yield* census.observe(launch))._tag).toBe("ExactLive")
        }
        yield* stopOwnedAppServer(ownership, census, launch, native)
        expect(signals).toContainEqual({ pid: -pid, signal: "SIGKILL" })
        const after = yield* census.observe(launch)
        expect(after._tag).toBe("Absent")
        const size = (yield* fileSystem.readFile(outputFile)).length
        yield* nodeCodexProcessNativeService.wait(50)
        expect((yield* fileSystem.readFile(outputFile)).length).toBe(size)
      }).pipe(Effect.provide(NodeServices.layer))
    )
  )
)

type OwnedActivityCensusService = {
  readonly observe: (
    thread: CodexThreadSnapshot,
    backgroundTerminals: ReadonlyArray<CodexBackgroundTerminal>,
    scope: "IntegratorSession" | "PlannedAttempt"
  ) => Effect.Effect<CodexOwnedActivityCensusProjection, CodexAppServerFailure>
  readonly terminateDescendants: (
    descendants: ReadonlyArray<CodexOwnedProcessIdentity>,
    scope: "IntegratorSession" | "PlannedAttempt"
  ) => Effect.Effect<void, CodexAppServerFailure>
}

const runCensus = (
  projection: (
    census: OwnedActivityCensusService
  ) => Effect.Effect<CodexOwnedActivityCensusProjection, CodexAppServerFailure>
) =>
  Effect.gen(function* () {
    const census = yield* CodexOwnedActivityCensus
    return yield* projection(census)
  })

it.effect("keeps controlled app-server and owned-activity substitutions at their public seams", () =>
  Effect.gen(function* () {
    const service: CodexAppServerService = {
      incarnation: CodexServerIncarnation.make("controlled-incarnation"),
      attachOwnedActivityHints: Effect.succeed(Stream.empty),
      attachTurnCompletedHints: Effect.succeed(Stream.empty),
      startThread: (cwd: string) =>
        Effect.succeed(thread("idle", [])).pipe(
          Effect.map((value) => ({ ...value, cwd: CodexThreadWorkingDirectory.make(cwd) }))
        ),
      readThread: () => Effect.succeed(thread("idle", [])),
      resumeThread: (threadId: CodexThreadId, cwd: string) =>
        Effect.succeed({ ...thread("idle", []), id: threadId, cwd: CodexThreadWorkingDirectory.make(cwd) }),
      startTurn: () => Effect.succeed(turn("controlled-turn", "inProgress")),
      interruptTurn: () => Effect.void,
      listBackgroundTerminals: () => Effect.succeed([]),
      terminateBackgroundTerminal: () => Effect.succeed(true),
      close: Effect.void
    }
    const result = yield* Effect.gen(function* () {
      const app = yield* CodexAppServer
      const started = yield* app.startThread("/public/worktree")
      expect(started.cwd).toBe("/public/worktree")
      expect((yield* app.startTurn(started.id, started.cwd, "text")).status).toBe("inProgress")
      expect(yield* app.terminateBackgroundTerminal(started.id, "terminal-process")).toBe(true)
    }).pipe(Effect.provide(controlledCodexAppServerLayer(service)))
    expect(result).toBeUndefined()

    const controlledProjection: CodexOwnedActivityCensusProjection = { _tag: "Absent" }
    const observed = yield* runCensus(() => Effect.succeed(controlledProjection)).pipe(
      Effect.provide(
        controlledCodexOwnedActivityCensusLayer({
          observe: () => Effect.succeed(controlledProjection),
          terminateDescendants: () => Effect.void
        })
      )
    )
    expect(observed).toEqual(controlledProjection)
  })
)

it.effect("reports exact owned activities only after fresh turn, terminal, and process observations", () =>
  Effect.gen(function* () {
    const absent = yield* runCensus((census) => census.observe(thread("idle", []), [], "IntegratorSession")).pipe(
      Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer)
    )
    expect(absent).toEqual({ _tag: "Absent" })

    const activeWithoutTurn = yield* runCensus((census) =>
      census.observe(thread("active", []), [], "IntegratorSession")
    ).pipe(Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer))
    expect(activeWithoutTurn._tag).toBe("Contradictory")

    const multipleTurns = yield* runCensus((census) =>
      census.observe(thread("idle", [turn("one", "inProgress"), turn("two", "inProgress")]), [], "IntegratorSession")
    ).pipe(Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer))
    expect(multipleTurns._tag).toBe("Contradictory")

    const activeTurn = yield* runCensus((census) =>
      census.observe(thread("idle", [turn("active", "inProgress")]), [], "IntegratorSession")
    ).pipe(Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer))
    expect(activeTurn).toEqual({
      _tag: "ExactLive",
      activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("active") }]
    })

    const background = yield* runCensus((census) =>
      census.observe(thread("idle", [turn("done", "completed")]), [terminal(null)], "IntegratorSession")
    ).pipe(Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer))
    expect(background).toMatchObject({ _tag: "ExactLive", activities: [{ _tag: "BackgroundTerminal" }] })

    const processBacked = yield* runCensus((census) =>
      census.observe(thread("idle", []), [terminal(nodeProcess.pid)], "IntegratorSession")
    ).pipe(Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer))
    expect(processBacked._tag).toBe("ExactLive")
    if (processBacked._tag === "ExactLive") {
      expect(processBacked.activities.some((activity) => activity._tag === "ProcessGroupDescendant")).toBe(true)
    }
  })
)

it.effect("keeps two independent session threads scoped to their own activity", () =>
  Effect.gen(function* () {
    const firstSession = thread("idle", [], "session-one-thread", "/session-one/worktree")
    const secondSession = thread(
      "idle",
      [turn("session-two-active-turn", "inProgress")],
      "session-two-thread",
      "/session-two/worktree"
    )
    const census = yield* CodexOwnedActivityCensus
    const firstProjection = yield* census.observe(firstSession, [], "IntegratorSession")
    const secondProjection = yield* census.observe(secondSession, [], "IntegratorSession")
    expect(firstProjection).toEqual({ _tag: "Absent" })
    expect(secondProjection).toEqual({
      _tag: "ExactLive",
      activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("session-two-active-turn") }]
    })
  }).pipe(Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer))
)

it.effect("keeps app-server token descendants out of Integrator sessions but in planned-attempt scope", () =>
  withFakeProcFiles(
    ["501", "502"],
    new Map([
      ["/proc/501/stat", { _tag: "Read", text: linuxProcessStat(501, 0, 501, "linux:leader") }],
      ["/proc/501/cmdline", { _tag: "Read", text: "codex\u0000app-server\u0000" }],
      ["/proc/501/environ", { _tag: "Read", text: "DALPH_CODEX_SERVER_INCARNATION=scope-token\u0000" }],
      ["/proc/502/stat", { _tag: "Read", text: linuxProcessStat(502, 501, 502, "linux:child") }],
      ["/proc/502/cmdline", { _tag: "Read", text: "/bin/sh\u0000" }],
      [
        "/proc/502/environ",
        { _tag: "Read", text: "DALPH_CODEX_SERVER_INCARNATION=scope-token\u0000CODEX_THREAD_ID=public-thread\u0000" }
      ]
    ]),
    (native) => {
      const census = makeNodeCodexOwnedActivityCensusService(
        native,
        501,
        CodexServerIncarnation.make("scope-token|linux%3Aleader")
      )
      return Effect.gen(function* () {
        expect(yield* census.observe(thread("idle", []), [], "IntegratorSession")).toEqual({ _tag: "Absent" })
        const planned = yield* census.observe(thread("idle", []), [], "PlannedAttempt")
        expect(planned).toMatchObject({
          _tag: "ExactLive",
          activities: [{ _tag: "ProcessGroupDescendant", identity: { pid: 502 } }]
        })
      })
    }
  )
)

it.effect("excludes only a settled provider code-mode host while retaining its task descendant", () =>
  withFakeProcFiles(
    ["501", "502", "503", "504"],
    new Map([
      ["/proc/501/stat", { _tag: "Read", text: linuxProcessStat(501, 0, 501, "linux:leader") }],
      ["/proc/501/cmdline", { _tag: "Read", text: "codex\u0000app-server\u0000" }],
      ["/proc/501/environ", { _tag: "Read", text: "DALPH_CODEX_SERVER_INCARNATION=scope-token\u0000" }],
      ["/proc/502/stat", { _tag: "Read", text: linuxProcessStat(502, 501, 501, "linux:native") }],
      ["/proc/502/cmdline", { _tag: "Read", text: "codex\u0000app-server\u0000" }],
      ["/proc/502/environ", { _tag: "Read", text: "DALPH_CODEX_SERVER_INCARNATION=scope-token\u0000" }],
      ["/proc/503/stat", { _tag: "Read", text: linuxProcessStat(503, 502, 503, "linux:host") }],
      ["/proc/503/cmdline", { _tag: "Read", text: "/vendor/bin/codex-code-mode-host\u0000" }],
      ["/proc/503/environ", { _tag: "Read", text: "DALPH_CODEX_SERVER_INCARNATION=scope-token\u0000" }],
      ["/proc/504/stat", { _tag: "Read", text: linuxProcessStat(504, 503, 504, "linux:writer") }],
      ["/proc/504/cmdline", { _tag: "Read", text: "/bin/sh\u0000" }],
      [
        "/proc/504/environ",
        { _tag: "Read", text: "DALPH_CODEX_SERVER_INCARNATION=scope-token\u0000CODEX_THREAD_ID=public-thread\u0000" }
      ]
    ]),
    (native) => {
      let writerPresent = true
      const census = makeNodeCodexOwnedActivityCensusService(
        {
          ...native,
          platform: "linux",
          readdir: async () => (writerPresent ? ["501", "502", "503", "504"] : ["501", "502", "503"])
        },
        501,
        CodexServerIncarnation.make("scope-token|linux%3Aleader")
      )
      return Effect.gen(function* () {
        const completed = thread("idle", [turn("done", "completed")])
        expect((yield* census.observe(completed, [], "PlannedAttempt"))._tag).toBe("Unreadable")
        expect(yield* census.observe(completed, [], "PlannedAttempt", true)).toMatchObject({
          _tag: "ExactLive",
          activities: [{ _tag: "ProcessGroupDescendant", identity: { pid: 504 } }]
        })
        writerPresent = false
        expect(yield* census.observe(completed, [], "PlannedAttempt", true)).toEqual({ _tag: "Absent" })
      })
    }
  )
)

it.effect("recognizes the settled provider code-mode host from Darwin process facts", () => {
  const started = "Fri Oct  2 22:00:00 2026"
  const stats = [
    `501 0 501 S ${started}`,
    `502 501 501 S ${started}`,
    `503 502 503 S ${started}`,
    `504 503 504 S ${started}`
  ]
  const commands = [
    "501 /vendor/bin/codex app-server DALPH_CODEX_SERVER_INCARNATION=scope-token",
    "502 /vendor/bin/codex app-server DALPH_CODEX_SERVER_INCARNATION=scope-token",
    "503 /vendor/bin/codex-code-mode-host DALPH_CODEX_SERVER_INCARNATION=scope-token",
    "504 /bin/sh DALPH_CODEX_SERVER_INCARNATION=scope-token CODEX_THREAD_ID=public-thread"
  ]
  let writerPresent = true
  let hostRecognized = true
  const native = {
    ...nodeCodexProcessNativeService,
    platform: "darwin" as const,
    execFile: async (_file: string, arguments_: ReadonlyArray<string>) => {
      const selected = writerPresent ? stats : stats.slice(0, -1)
      const selectedCommands = (writerPresent ? commands : commands.slice(0, -1)).map((command, index) =>
        index === 2 && !hostRecognized ? command.replace("codex-code-mode-host", "unknown-helper") : command
      )
      if (arguments_.includes("pid=,ppid=,pgid=,stat=,lstart=")) return { stdout: `${selected.join("\n")}\n` }
      if (arguments_.includes("pid=,command=")) return { stdout: `${selectedCommands.join("\n")}\n` }
      return { stdout: "/bin/sh\n" }
    }
  }
  const census = makeNodeCodexOwnedActivityCensusService(
    native,
    501,
    CodexServerIncarnation.make("scope-token|darwin%3AFri%20Oct%20%202%2022%3A00%3A00%202026")
  )
  return Effect.gen(function* () {
    const completed = thread("idle", [turn("done", "completed")])
    expect((yield* census.observe(completed, [], "PlannedAttempt"))._tag).toBe("Unreadable")
    expect(yield* census.observe(completed, [], "PlannedAttempt", true)).toMatchObject({
      _tag: "ExactLive",
      activities: [{ _tag: "ProcessGroupDescendant", identity: { pid: 504 } }]
    })
    writerPresent = false
    expect(yield* census.observe(completed, [], "PlannedAttempt", true)).toEqual({ _tag: "Absent" })
    hostRecognized = false
    expect((yield* census.observe(completed, [], "PlannedAttempt", true))._tag).toBe("Unreadable")
  })
})

it.effect("classifies controlled Linux process census observations at the public activity boundary", () => {
  const liveKill = (() => true) as typeof nodeProcess.kill
  const valid = (pid: number, parentPid: number, processGroupId: number, startIdentity = "start") => ({
    _tag: "Read" as const,
    text: linuxProcessStat(pid, parentPid, processGroupId, startIdentity)
  })
  const cases: ReadonlyArray<{
    readonly entries: ReadonlyArray<string>
    readonly stats: ReadonlyMap<number, FakeLinuxProcessStat>
    readonly rootPid: number
    readonly expected: CodexOwnedActivityCensusProjection
  }> = [
    {
      entries: ["self", "thread-self", "101"],
      stats: new Map([[101, { _tag: "Read", text: "malformed" }]]),
      rootPid: 101,
      expected: { _tag: "Unreadable", detail: "process 101 stat is malformed" }
    },
    {
      entries: ["102"],
      stats: new Map([[102, { _tag: "Read", text: "102 (fixture-codex) S not-a-pid 1" }]]),
      rootPid: 102,
      expected: { _tag: "Unreadable", detail: "process 102 stat is malformed" }
    },
    {
      entries: ["self", "103"],
      stats: new Map([[103, { _tag: "Error", error: Object.assign(new Error("vanished"), { code: "ESRCH" }) }]]),
      rootPid: 999,
      expected: { _tag: "ExactLive", activities: [{ _tag: "BackgroundTerminal", terminal: terminal(999) }] }
    },
    {
      entries: ["104"],
      stats: new Map([[104, valid(104, 0, 0)]]),
      rootPid: 104,
      expected: { _tag: "Contradictory", detail: "attempt activity 104 has no valid process group" }
    },
    {
      entries: ["self", "thread-self", "0", "999999999999999999999", "105"],
      stats: new Map([[105, valid(105, 0, 105)]]),
      rootPid: 105,
      expected: {
        _tag: "ExactLive",
        activities: [
          { _tag: "BackgroundTerminal", terminal: terminal(105) },
          {
            _tag: "ProcessGroupDescendant",
            identity: {
              pid: 105,
              parentPid: 0,
              processGroupId: 105,
              startIdentity: CodexProcessStartIdentity.make("linux:start")
            }
          }
        ]
      }
    },
    {
      entries: ["106", "107", "108", "109", "110"],
      stats: new Map([
        [106, valid(106, 0, 106, "root")],
        [107, valid(107, 106, 107, "child")],
        [108, valid(108, 107, 108, "grandchild")],
        [109, valid(109, 999, 109, "orphan")],
        [110, valid(110, 110, 110, "cycle")]
      ]),
      rootPid: 106,
      expected: {
        _tag: "ExactLive",
        activities: [
          { _tag: "BackgroundTerminal", terminal: terminal(106) },
          {
            _tag: "ProcessGroupDescendant",
            identity: {
              pid: 106,
              parentPid: 0,
              processGroupId: 106,
              startIdentity: CodexProcessStartIdentity.make("linux:root")
            }
          },
          {
            _tag: "ProcessGroupDescendant",
            identity: {
              pid: 107,
              parentPid: 106,
              processGroupId: 107,
              startIdentity: CodexProcessStartIdentity.make("linux:child")
            }
          },
          {
            _tag: "ProcessGroupDescendant",
            identity: {
              pid: 108,
              parentPid: 107,
              processGroupId: 108,
              startIdentity: CodexProcessStartIdentity.make("linux:grandchild")
            }
          }
        ]
      }
    }
  ]
  return Effect.forEach(cases, ({ entries, expected, rootPid, stats }) =>
    withFakeLinuxProc(
      entries,
      stats,
      runCensus((census) => census.observe(thread("idle", []), [terminal(rootPid)], "IntegratorSession")).pipe(
        Effect.map((observed) => expect(observed).toEqual(expected))
      ),
      liveKill
    )
  )
})

const makeTwoThreadActivityNative = () => {
  const token = CodexServerIncarnation.make("two-thread-incarnation")
  const threadA = CodexThreadId.make("thread-A")
  const threadB = CodexThreadId.make("thread-B")
  const processA = 181
  const processB = 182
  const processWithoutThread = 183
  const live = new Set([processA, processB, processWithoutThread])
  const killed: Array<number> = []
  const threadForProcess = (pid: number) => (pid === processA ? threadA : threadB)
  const readFile = async (path: string): Promise<string> => {
    const match = /\/proc\/([0-9]+)\/(stat|cmdline|environ)$/.exec(path)
    if (match === null) {
      const error = Object.assign(new Error(`unexpected process file ${path}`), { code: "ENOENT" })
      // eslint-disable-next-line functional/no-throw-statements -- controlled proc reader rejects an unknown fixture path.
      throw error
    }
    const pid = Number(match[1])
    if (!live.has(pid)) {
      const error = Object.assign(new Error(`process ${pid} is absent`), { code: "ESRCH" })
      // eslint-disable-next-line functional/no-throw-statements -- controlled native boundary reports an absent process.
      throw error
    }
    if (match[2] === "stat") return linuxProcessStat(pid, 0, pid, `two-thread-${pid}`)
    if (match[2] === "cmdline") return "fixture-worker\u0000"
    return pid === processWithoutThread
      ? `DALPH_CODEX_SERVER_INCARNATION=${token}\u0000`
      : `DALPH_CODEX_SERVER_INCARNATION=${token}\u0000CODEX_THREAD_ID=${threadForProcess(pid)}\u0000`
  }
  const kill = ((pid: number, signal?: number | NodeJS.Signals) => {
    if (!live.has(pid)) {
      const error = Object.assign(new Error(`process ${pid} is absent`), { code: "ESRCH" })
      // eslint-disable-next-line functional/no-throw-statements -- controlled kill boundary reports an absent process.
      throw error
    }
    if (signal !== 0) {
      killed.push(pid)
      live.delete(pid)
    }
    return true
  }) as typeof nodeProcess.kill
  return {
    census: makeNodeCodexOwnedActivityCensusService(
      { ...nodeCodexProcessNativeService, kill, readFile, readdir: async () => [...live].map(String) },
      undefined,
      token
    ),
    forgetA: () => live.delete(processA),
    killed,
    processA,
    processB,
    processWithoutThread,
    threadA: { id: threadA, cwd: CodexThreadWorkingDirectory.make("/thread-A"), status: "idle" as const, turns: [] }
  }
}

const makePlannedAttemptEscapedHelper = (
  threadIdentity: string | undefined,
  recheck: "Live" | "Absent" | "Reused" | "Unreadable" = "Live"
) => {
  const token = CodexServerIncarnation.make("planned-attempt-incarnation")
  const appServerPid = 190
  const helperPid = 191
  const live = new Set([appServerPid, helperPid])
  const killed: Array<number> = []
  const environmentRead = new Set<number>()
  const readFile = async (path: string): Promise<string> => {
    const match = /\/proc\/([0-9]+)\/(stat|cmdline|environ)$/.exec(path)
    if (match === null) {
      const error = Object.assign(new Error(`unexpected process file ${path}`), { code: "ENOENT" })
      // eslint-disable-next-line functional/no-throw-statements -- controlled proc reader rejects an unknown fixture path.
      throw error
    }
    const pid = Number(match[1])
    if (!live.has(pid)) {
      const error = Object.assign(new Error(`process ${pid} is absent`), { code: "ESRCH" })
      // eslint-disable-next-line functional/no-throw-statements -- controlled native boundary reports an absent process.
      throw error
    }
    if (match[2] === "stat") {
      if (environmentRead.has(pid) && recheck === "Unreadable")
        throw Object.assign(new Error("fresh stat unavailable"), { code: "EACCES" })
      return pid === appServerPid
        ? linuxProcessStat(pid, 0, appServerPid, `planned-server-${pid}`)
        : linuxProcessStat(
            pid,
            appServerPid,
            helperPid,
            environmentRead.has(pid) && recheck === "Reused" ? "replacement-start" : `planned-helper-${pid}`
          )
    }
    if (match[2] === "cmdline") {
      return pid === appServerPid ? "codex\u0000app-server\u0000" : "codex-code-mode-host\u0000"
    }
    if (pid === appServerPid) return `DALPH_CODEX_SERVER_INCARNATION=${token}\u0000`
    environmentRead.add(pid)
    if (recheck === "Absent") live.delete(pid)
    return [
      `DALPH_CODEX_SERVER_INCARNATION=${token}`,
      ...(threadIdentity === undefined ? [] : [`CODEX_THREAD_ID=${threadIdentity}`])
    ].join("\u0000")
  }
  const kill = ((pid: number, signal?: number | NodeJS.Signals) => {
    if (!live.has(pid)) {
      const error = Object.assign(new Error(`process ${pid} is absent`), { code: "ESRCH" })
      // eslint-disable-next-line functional/no-throw-statements -- controlled kill boundary reports an absent process.
      throw error
    }
    if (signal !== 0) {
      killed.push(pid)
      live.delete(pid)
    }
    return true
  }) as typeof nodeProcess.kill
  return {
    census: makeNodeCodexOwnedActivityCensusService(
      { ...nodeCodexProcessNativeService, kill, readFile, readdir: async () => [...live].map(String) },
      appServerPid,
      token
    ),
    helperPid,
    killed,
    threadA: thread("idle", [], "thread-A")
  }
}

it.effect("planned-attempt census excludes foreign-thread helpers", () =>
  Effect.gen(function* () {
    const fixture = makePlannedAttemptEscapedHelper("thread-B")
    expect(yield* fixture.census.observe(fixture.threadA, [], "PlannedAttempt")).toEqual({ _tag: "Absent" })
  })
)

for (const recheck of ["Live", "Reused", "Unreadable"] as const)
  it.effect(`planned-attempt census keeps missing-thread helpers unresolved (${recheck})`, () =>
    Effect.gen(function* () {
      const fixture = makePlannedAttemptEscapedHelper(undefined, recheck)
      expect(yield* fixture.census.observe(fixture.threadA, [], "PlannedAttempt")).toMatchObject({
        _tag: "Unreadable",
        detail: expect.stringContaining("thread identity")
      })
      expect(fixture.killed).toEqual([])
    })
  )

it.effect("planned-attempt census excludes a missing-thread helper only after fresh process absence", () =>
  Effect.gen(function* () {
    const fixture = makePlannedAttemptEscapedHelper(undefined, "Absent")
    const active = thread("active", [turn("active", "inProgress")], "thread-A")
    expect(yield* fixture.census.observe(active, [], "PlannedAttempt")).toEqual({
      _tag: "ExactLive",
      activities: [{ _tag: "ActiveTurn", turnId: CodexTurnId.make("active") }]
    })
    expect(fixture.killed).toEqual([])
  })
)

it.effect("planned-attempt census counts exact-thread escaped helpers", () =>
  Effect.gen(function* () {
    const fixture = makePlannedAttemptEscapedHelper("thread-A")
    const observed = yield* fixture.census.observe(fixture.threadA, [], "PlannedAttempt")
    expect(observed).toMatchObject({
      _tag: "ExactLive",
      activities: [{ _tag: "ProcessGroupDescendant", identity: { pid: fixture.helperPid } }]
    })
    if (observed._tag !== "ExactLive") return yield* Effect.die("exact-thread helper must remain visible")
    const descendants = observed.activities.flatMap((activity) =>
      activity._tag === "ProcessGroupDescendant" ? [activity.identity] : []
    )
    yield* fixture.census.terminateDescendants(descendants, "PlannedAttempt")
    expect(fixture.killed).toEqual([fixture.helperPid])
    expect(yield* fixture.census.observe(fixture.threadA, [], "PlannedAttempt")).toEqual({ _tag: "Absent" })
  })
)

it.effect("keeps Integrator activity census scoped to its reported terminal root", () =>
  Effect.gen(function* () {
    const fixture = makeTwoThreadActivityNative()
    const backgroundTerminal = terminal(fixture.processA)
    const observed = yield* fixture.census.observe(fixture.threadA, [backgroundTerminal], "IntegratorSession")
    expect(observed).toMatchObject({
      _tag: "ExactLive",
      activities: [
        { _tag: "BackgroundTerminal", terminal: backgroundTerminal },
        { _tag: "ProcessGroupDescendant", identity: { pid: fixture.processA } }
      ]
    })
    if (observed._tag === "ExactLive") {
      expect(
        observed.activities.some(
          (activity) => activity._tag === "ProcessGroupDescendant" && activity.identity.pid === fixture.processB
        )
      ).toBe(false)
      expect(
        observed.activities.some(
          (activity) =>
            activity._tag === "ProcessGroupDescendant" && activity.identity.pid === fixture.processWithoutThread
        )
      ).toBe(false)
    }

    fixture.forgetA()
    expect(yield* fixture.census.observe(fixture.threadA, [], "IntegratorSession")).toEqual({ _tag: "Absent" })
  })
)

it.effect("suspension census for one Codex thread never signals another thread", () =>
  Effect.gen(function* () {
    const fixture = makeTwoThreadActivityNative()
    const backgroundTerminal = terminal(fixture.processA)
    const observed = yield* fixture.census.observe(fixture.threadA, [backgroundTerminal], "IntegratorSession")
    if (observed._tag !== "ExactLive") return yield* Effect.die("thread A must expose its exact descendant")
    const descendants = observed.activities.flatMap((activity) =>
      activity._tag === "ProcessGroupDescendant" ? [activity.identity] : []
    )

    yield* fixture.census.terminateDescendants(descendants, "IntegratorSession")

    expect(fixture.killed).toEqual([fixture.processA])
    expect(fixture.killed).not.toContain(fixture.processB)
    expect(yield* fixture.census.observe(fixture.threadA, [], "IntegratorSession")).toEqual({ _tag: "Absent" })
  })
)

it.effect("revalidates and signals controlled Linux descendants without touching native processes", () => {
  const member = (pid: number, startIdentity = "same", processGroupId = pid): CodexOwnedProcessIdentity => ({
    pid,
    parentPid: 0,
    processGroupId,
    startIdentity: CodexProcessStartIdentity.make(`linux:${startIdentity}`)
  })
  const valid = (pid: number, startIdentity = "same", processGroupId = pid): FakeLinuxProcessStat => ({
    _tag: "Read",
    text: linuxProcessStat(pid, 0, processGroupId, startIdentity)
  })
  const terminate = (descendant: CodexOwnedProcessIdentity) =>
    Effect.gen(function* () {
      const census = yield* CodexOwnedActivityCensus
      return yield* census.terminateDescendants([descendant], "IntegratorSession")
    })
  const absent = Effect.gen(function* () {
    const census = yield* CodexOwnedActivityCensus
    return yield* census.terminateDescendants([], "IntegratorSession")
  }).pipe(Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer))
  const errorKill = (() => {
    // eslint-disable-next-line functional/no-throw-statements -- the controlled kill fixture emulates a native signal failure.
    throw new Error("signal failed")
  }) as typeof nodeProcess.kill
  const absentKill = (() => {
    // eslint-disable-next-line functional/no-throw-statements -- the controlled kill fixture emulates ESRCH from the native boundary.
    throw Object.assign(new Error("gone"), { code: "ESRCH" })
  }) as typeof nodeProcess.kill
  const liveKill = (() => true) as typeof nodeProcess.kill
  const stoppedStats = new Map<number, FakeLinuxProcessStat>([[208, valid(208)]])
  const successfulKill = ((_pid: number, signal?: number | NodeJS.Signals) => {
    if (signal === 0 && !stoppedStats.has(208)) {
      // eslint-disable-next-line functional/no-throw-statements -- the native fixture reports the post-signal process as absent.
      throw Object.assign(new Error("gone"), { code: "ESRCH" })
    }
    if (signal !== 0) {
      // eslint-disable-next-line functional/immutable-data -- the native fixture advances its one observed process from live to absent.
      stoppedStats.delete(208)
    }
    return true
  }) as typeof nodeProcess.kill
  const cases: ReadonlyArray<{
    readonly stats: ReadonlyMap<number, FakeLinuxProcessStat>
    readonly descendant: CodexOwnedProcessIdentity
    readonly expectedFailure?: string
    readonly kill?: typeof nodeProcess.kill
  }> = [
    { stats: new Map(), descendant: member(201) },
    {
      stats: new Map([[202, { _tag: "Error", error: Object.assign(new Error("gone"), { code: "ESRCH" }) }]]),
      descendant: member(202)
    },
    {
      stats: new Map([[203, { _tag: "Error", error: Object.assign(new Error("I/O"), { code: "EIO" }) }]]),
      descendant: member(203),
      expectedFailure: "cannot read process 203"
    },
    {
      stats: new Map([[204, { _tag: "Read", text: "204 (fixture-codex) broken" }]]),
      descendant: member(204),
      kill: liveKill,
      expectedFailure: "process 204 stat is malformed"
    },
    {
      stats: new Map([[205, valid(205, "replacement")]]),
      descendant: member(205),
      expectedFailure: "changed identity"
    },
    {
      stats: new Map([[206, valid(206)]]),
      descendant: member(206),
      kill: absentKill,
      expectedFailure: "did not become absent"
    },
    { stats: new Map([[207, valid(207)]]), descendant: member(207), kill: errorKill, expectedFailure: "signal failed" },
    { stats: stoppedStats, descendant: member(208), kill: successfulKill }
  ]
  const unsupportedLayer = Layer.succeed(
    CodexOwnedActivityCensus,
    makeNodeCodexOwnedActivityCensusService({ ...nodeCodexProcessNativeService, platform: "freebsd" })
  )
  return Effect.gen(function* () {
    const empty = yield* absent
    expect(empty).toBeUndefined()
    const unsupported = yield* Effect.gen(function* () {
      const census = yield* CodexOwnedActivityCensus
      return yield* census.terminateDescendants([member(209)], "IntegratorSession")
    }).pipe(Effect.provide(unsupportedLayer), Effect.exit)
    expect(Exit.isFailure(unsupported)).toBe(true)
    yield* Effect.forEach(cases, ({ descendant, expectedFailure, kill, stats }) => {
      const outcome = withFakeLinuxProc([String(descendant.pid)], stats, terminate(descendant).pipe(Effect.exit), kill)
      return outcome.pipe(
        Effect.map((result) => {
          if (expectedFailure === undefined) {
            expect(Exit.isSuccess(result), `expected process ${descendant.pid} cleanup to succeed`).toBe(true)
          } else {
            expect(Exit.isFailure(result)).toBe(true)
            if (Exit.isFailure(result)) {
              const failure = Cause.findErrorOption(result.cause)
              expect(Option.isSome(failure)).toBe(true)
              if (Option.isSome(failure)) expect(failure.value.detail).toContain(expectedFailure)
            }
          }
        })
      )
    })
  })
})

it.effect("revalidates exact descendant identities before stopping owned activity", () =>
  Effect.gen(function* () {
    const census = yield* CodexOwnedActivityCensus.pipe(Effect.provide(standaloneNodeCodexOwnedActivityCensusLayer))
    yield* census.terminateDescendants(
      [
        {
          pid: 999_999_999,
          parentPid: 1,
          processGroupId: 1,
          startIdentity: CodexProcessStartIdentity.make("linux:missing")
        }
      ],
      "IntegratorSession"
    )

    const changed = yield* census
      .terminateDescendants(
        [
          {
            pid: nodeProcess.pid,
            parentPid: 1,
            processGroupId: 1,
            startIdentity: CodexProcessStartIdentity.make("linux:foreign")
          }
        ],
        "IntegratorSession"
      )
      .pipe(Effect.exit)
    expect(Exit.isFailure(changed)).toBe(true)
  })
)

it.effect("keeps unsupported host process census fail-closed", () =>
  Effect.gen(function* () {
    const census = yield* CodexOwnedActivityCensus
    const observed = yield* census.observe(thread("idle", []), [terminal(nodeProcess.pid)], "IntegratorSession")
    expect(observed).toEqual({
      _tag: "Unreadable",
      detail: "owned attempt process census is not qualified on this host"
    })
  }).pipe(
    Effect.provide(
      Layer.succeed(
        CodexOwnedActivityCensus,
        makeNodeCodexOwnedActivityCensusService({ ...nodeCodexProcessNativeService, platform: "freebsd" })
      )
    )
  )
)

it.effect("reconciles an exact launch-token process before starting a replacement server", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-public-discovery-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, discoveryFixture)
      yield* fileSystem.chmod(executable, 0o755)
      const token = "public-discovery-token"
      const child = spawn(executable, ["app-server"], {
        detached: true,
        env: { ...nodeProcess.env, DALPH_CODEX_SERVER_INCARNATION: token, DALPH_DISCOVERY_READY: "1" },
        stdio: ["ignore", "ignore", "pipe"]
      })
      yield* Effect.tryPromise(
        () =>
          new Promise<void>((resolve, reject) => {
            child.stderr.once("data", () => resolve())
            child.once("error", reject)
            child.once("exit", (code, signal) => reject(new Error(`discovery fixture exited: ${code}/${signal}`)))
          })
      )
      const childPid = child.pid
      expect(childPid).toBeGreaterThan(0)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (childPid !== undefined) {
            try {
              nodeProcess.kill(-childPid, "SIGKILL")
            } catch {
              // The ownership boundary may already have stopped this exact child.
            }
          }
        })
      )
      const prior = CodexServerLaunchRecord.make({
        command: [executable, "app-server"],
        incarnation: CodexServerIncarnation.make(token),
        phase: "Launching",
        pid: null
      })
      const home = yield* resolveCodexProviderHome(path.join(root, "provider-home"))
      const serverStartup = yield* Schema.decodeUnknownEffect(CodexServerStartupRecord)({
        _tag: "Initialized",
        startupId: "public-discovery-prior-startup",
        home,
        intendedAtMilliseconds: 0,
        deadlineMilliseconds: 30_000,
        initializedAtMilliseconds: 0
      })
      const layer = codexAppServerNodeLayer(
        { executable, environment: { CODEX_HOME: home } },
        isolatedCodexProcessNativeService
      ).pipe(
        Layer.provide(
          memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior, serverStartup, replacements: [] })
        )
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        const started = yield* app.startThread("/public/discovery/worktree").pipe(Effect.exit)
        if (Exit.isSuccess(started)) {
          expect(started.value.cwd).toBe("/public/discovery/worktree")
          yield* app.close.pipe(Effect.exit)
        } else {
          const failure = Cause.findErrorOption(started.cause)
          expect(Option.isSome(failure)).toBe(true)
          if (Option.isSome(failure)) {
            expect(failure.value).toBeInstanceOf(CodexAppServerFailure)
            if (failure.value instanceof CodexAppServerFailure) {
              expect(failure.value.detail).toMatch(
                /different launch token|not qualified|cannot observe|not the recorded Codex executable/
              )
            }
          }
        }
      }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer), Effect.exit)
      if (Exit.isFailure(result)) return yield* Effect.fail(Cause.squash(result.cause))
      expect(Exit.isSuccess(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("classifies controlled Unix launch identity observations before replacement", () => {
  const executable = "/controlled/codex"
  const expectedStat = linuxProcessStat(301, 0, 301, "expected")
  const cases: ReadonlyArray<{
    readonly observation: FakeLaunchObservation
    readonly incarnation: CodexServerIncarnation
  }> = [
    {
      observation: { commandLine: "/foreign/codex\u0000app-server\u0000", stat: expectedStat },
      incarnation: CodexServerIncarnation.make("launch-identity|linux%3Aexpected")
    },
    {
      observation: { commandLine: `${executable}\u0000`, stat: expectedStat },
      incarnation: CodexServerIncarnation.make("launch-mode|linux%3Aexpected")
    },
    {
      observation: { commandLine: `${executable}\u0000app-server\u0000`, stat: expectedStat },
      incarnation: CodexServerIncarnation.make("launch-without-identity")
    },
    {
      observation: { commandLine: `${executable}\u0000app-server\u0000`, stat: "malformed" },
      incarnation: CodexServerIncarnation.make("launch-missing-process-identity|linux%3Aexpected")
    },
    {
      observation: {
        commandLine: `${executable}\u0000app-server\u0000`,
        stat: linuxProcessStat(301, 0, 301, "replacement")
      },
      incarnation: CodexServerIncarnation.make("launch-replaced-process|linux%3Aexpected")
    },
    {
      observation: { killError: Object.assign(new Error("gone"), { code: "ESRCH" }) },
      incarnation: CodexServerIncarnation.make("launch-gone|linux%3Aexpected")
    },
    {
      observation: { killError: Object.assign(new Error("permission denied"), { code: "EACCES" }) },
      incarnation: CodexServerIncarnation.make("launch-unreadable|linux%3Aexpected")
    },
    {
      observation: { platform: "darwin" },
      incarnation: CodexServerIncarnation.make("launch-unsupported|linux%3Aexpected")
    }
  ]
  return Effect.forEach(cases, ({ incarnation, observation }) =>
    withFakeLaunchObservation(observation, (native) =>
      Effect.scoped(
        Effect.gen(function* () {
          const prior = CodexServerLaunchRecord.make({
            command: [executable, "app-server"],
            incarnation,
            phase: "Live",
            pid: 301
          })
          const layer = codexAppServerNodeLayer({ executable: "/missing/controlled-codex" }, native).pipe(
            Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior, replacements: [] }))
          )
          const result = yield* Effect.gen(function* () {
            const app = yield* CodexAppServer
            return yield* Effect.exit(app.startThread("/controlled-launch/worktree"))
          }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer), Effect.exit)
          expect(Exit.isSuccess(result)).toBe(true)
        }).pipe(Effect.provide(NodeServices.layer))
      )
    )
  )
})

it.effect("reconciles application lease owner identity before spawning", () => {
  const stat = (startIdentity: string): FakeProcFile => ({
    _tag: "Read",
    text: linuxProcessStat(nodeProcess.pid, 0, nodeProcess.pid, startIdentity)
  })
  const cases: ReadonlyArray<{
    readonly stats: ReadonlyArray<FakeProcFile>
    readonly killError?: unknown
    readonly expected: "Absent" | "ExactLive" | "Unreadable" | "Contradictory"
    readonly switchUnsupported?: boolean
  }> = [
    { stats: [stat("owner"), stat("owner")], expected: "ExactLive" },
    { stats: [stat("owner"), stat("foreign")], expected: "Contradictory" },
    { stats: [stat("owner"), { _tag: "Read", text: "malformed" }], expected: "Unreadable" },
    { stats: [stat("owner")], killError: Object.assign(new Error("gone"), { code: "ESRCH" }), expected: "Absent" },
    {
      stats: [stat("owner")],
      killError: Object.assign(new Error("permission denied"), { code: "EIO" }),
      expected: "Unreadable"
    },
    { stats: [stat("owner")], expected: "Unreadable", switchUnsupported: true }
  ]
  return Effect.forEach(cases.entries(), ([caseIndex, { expected, killError, stats, switchUnsupported }]) =>
    withFakeLeaseProc(stats, killError, (native, switchToUnsupportedPlatform) =>
      Effect.scoped(
        Effect.gen(function* () {
          const startupStore = yield* CodexAttemptStore.pipe(Effect.provide(memoryCodexAttemptStoreLayer()))
          const store: CodexAttemptStoreService = {
            readServerStartup: startupStore.readServerStartup,
            writeServerStartup: startupStore.writeServerStartup,
            hasRetainedAttempts: () => Effect.succeed(false),
            readAttempt: () => Effect.succeed(Option.none()),
            writeAttempt: () => Effect.void,
            readReplacementLedger: () => Effect.succeed(Option.none()),
            appendReplacementLedger: () => Effect.void,
            readServerLaunch: () => Effect.succeed(Option.none()),
            writeServerLaunch: () => Effect.void,
            clearServerLaunch: () => Effect.void,
            acquireServerLease: (_owner, observe) =>
              Effect.gen(function* () {
                if (switchUnsupported === true) switchToUnsupportedPlatform()
                const projection = yield* observe(_owner)
                expect(projection._tag).toBe(expected)
                return yield* new CodexAttemptStoreFailure({
                  detail: "controlled lease outcome",
                  operation: "acquireServerLease"
                })
              }),
            releaseServerLease: () => Effect.void
          }
          const layer = codexAppServerNodeLayer({ executable: "/missing/lease-codex" }, native).pipe(
            Layer.provide(Layer.succeed(CodexAttemptStore, store))
          )
          const result = yield* Effect.gen(function* () {
            yield* CodexAppServer
          }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer), Effect.exit)
          expect(Exit.isFailure(result), `lease case ${caseIndex}: projection ${expected}`).toBe(true)
        }).pipe(Effect.provide(NodeServices.layer))
      )
    )
  )
})

it.effect("classifies controlled launch-token discovery candidates before replacement", () => {
  const executable = "/controlled/discovery-codex"
  const token = "discovery-token"
  const file = (text: string): FakeProcFile => ({ _tag: "Read", text })
  const error = (code: string): FakeProcFile => ({ _tag: "Error", error: Object.assign(new Error(code), { code }) })
  const candidate = (
    pid: number,
    commandLine: FakeProcFile,
    environment?: FakeProcFile,
    stat?: FakeProcFile
  ): ReadonlyArray<readonly [string, FakeProcFile]> => [
    [`/proc/${pid}/cmdline`, commandLine],
    ...(environment === undefined ? [] : [[`/proc/${pid}/environ`, environment] as const]),
    ...(stat === undefined ? [] : [[`/proc/${pid}/stat`, stat] as const])
  ]
  const cases: ReadonlyArray<{
    readonly entries: ReadonlyArray<string>
    readonly files: ReadonlyMap<string, FakeProcFile>
  }> = [
    {
      entries: ["self", "thread-self", "0", "999999999999999999999", "401"],
      files: new Map(candidate(401, file("/foreign/worker\u0000")))
    },
    {
      entries: ["402"],
      files: new Map(candidate(402, file("/controlled/discovery-codex\u0000app-server\u0000"), file("PATH=x\u0000")))
    },
    {
      entries: ["403"],
      files: new Map(
        candidate(
          403,
          file("/controlled/discovery-codex\u0000app-server\u0000"),
          file("DALPH_CODEX_SERVER_INCARNATION=foreign\u0000"),
          file(linuxProcessStat(403, 0, 403, "foreign"))
        )
      )
    },
    {
      entries: ["404", "405"],
      files: new Map([
        ...candidate(
          404,
          file("/controlled/discovery-codex\u0000app-server\u0000"),
          file(`DALPH_CODEX_SERVER_INCARNATION=${token}\u0000`),
          file(linuxProcessStat(404, 0, 404, "exact"))
        ),
        ...candidate(
          405,
          file("/controlled/discovery-codex\u0000app-server\u0000"),
          file("DALPH_CODEX_SERVER_INCARNATION=foreign\u0000"),
          file(linuxProcessStat(405, 0, 405, "foreign"))
        )
      ])
    },
    { entries: ["406"], files: new Map(candidate(406, error("EIO"))) },
    { entries: ["407"], files: new Map(candidate(407, error("ESRCH"))) },
    {
      entries: ["408"],
      files: new Map(
        candidate(
          408,
          file("/controlled/discovery-codex\u0000app-server\u0000"),
          file(`DALPH_CODEX_SERVER_INCARNATION=${token}\u0000`),
          file("malformed")
        )
      )
    },
    {
      entries: ["409"],
      files: new Map(candidate(409, file("/controlled/discovery-codex\u0000app-server\u0000"), error("EIO")))
    },
    {
      entries: ["410", "411"],
      files: new Map([
        ...candidate(
          410,
          file("/controlled/discovery-codex\u0000app-server\u0000"),
          file(`DALPH_CODEX_SERVER_INCARNATION=${token}\u0000`),
          file(linuxProcessStat(410, 0, 410, "exact-one"))
        ),
        ...candidate(
          411,
          file("/controlled/discovery-codex\u0000app-server\u0000"),
          file(`DALPH_CODEX_SERVER_INCARNATION=${token}\u0000`),
          file(linuxProcessStat(411, 0, 411, "exact-two"))
        )
      ])
    }
  ]
  return Effect.forEach(cases, ({ entries, files }) =>
    withFakeProcFiles(entries, files, (native) =>
      Effect.scoped(
        Effect.gen(function* () {
          const prior = CodexServerLaunchRecord.make({
            command: [executable, "app-server"],
            incarnation: CodexServerIncarnation.make(`${token}|linux%3Aold`),
            phase: "Launching",
            pid: null
          })
          const layer = codexAppServerNodeLayer({ executable: "/missing/controlled-discovery-codex" }, native).pipe(
            Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior, replacements: [] }))
          )
          const result = yield* Effect.gen(function* () {
            const app = yield* CodexAppServer
            return yield* Effect.exit(app.startThread("/controlled-discovery/worktree"))
          }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer), Effect.exit)
          expect(Exit.isSuccess(result)).toBe(true)
        }).pipe(Effect.provide(NodeServices.layer))
      )
    )
  )
})

it.effect("reconciles controlled detached process-group ownership before close", () =>
  Effect.forEach(
    [
      { startIdentity: "foreign", processGroupId: "same" as const, expectedFailure: true },
      { startIdentity: "expected", processGroupId: "foreign" as const, expectedFailure: true },
      { startIdentity: "expected", processGroupId: "same" as const, expectedFailure: false }
    ] as const,
    ({ expectedFailure, processGroupId, startIdentity }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-public-process-group-" })
          const executable = path.join(root, "fixture-codex")
          yield* fileSystem.writeFileString(executable, discoveryFixture)
          yield* fileSystem.chmod(executable, 0o755)
          let launch: CodexServerLaunchRecord | undefined
          const startupStore = yield* CodexAttemptStore.pipe(Effect.provide(memoryCodexAttemptStoreLayer()))
          const store: CodexAttemptStoreService = {
            readServerStartup: startupStore.readServerStartup,
            writeServerStartup: startupStore.writeServerStartup,
            hasRetainedAttempts: () => Effect.succeed(false),
            readAttempt: () => Effect.succeed(Option.none()),
            writeAttempt: () => Effect.void,
            readReplacementLedger: () => Effect.succeed(Option.none()),
            appendReplacementLedger: () => Effect.void,
            readServerLaunch: () => Effect.succeed(launch === undefined ? Option.none() : Option.some(launch)),
            writeServerLaunch: (record) => Effect.sync(() => void (launch = record)),
            clearServerLaunch: () =>
              Effect.sync(() => {
                launch = undefined
              }),
            acquireServerLease: () => Effect.void,
            releaseServerLease: () => Effect.void
          }
          const controlledProcessGroup = controlledProcessGroupNative()
          const layer = codexAppServerNodeLayer({ executable }, controlledProcessGroup.native).pipe(
            Layer.provide(Layer.succeed(CodexAttemptStore, store))
          )
          const result = yield* Effect.gen(function* () {
            const app = yield* CodexAppServer
            yield* app.startThread("/controlled-process-group/worktree")
            const liveLaunch = launch
            const livePid = liveLaunch?.pid
            expect(livePid).toBeGreaterThan(0)
            if (liveLaunch === undefined) return
            if (livePid === undefined || livePid === null) return
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                try {
                  nodeProcess.kill(-livePid, "SIGKILL")
                } catch {
                  // The ownership boundary may already have stopped this exact child.
                }
              })
            )
            const separator = app.incarnation.lastIndexOf("|")
            const observedIdentity = decodeURIComponent(app.incarnation.slice(separator + 1))
            const startToken = observedIdentity.startsWith("linux:")
              ? observedIdentity.slice("linux:".length)
              : observedIdentity
            const observedGroupId = processGroupId === "same" ? livePid : livePid + 1
            controlledProcessGroup.configure({
              command: liveLaunch.command,
              pid: livePid,
              startIdentity: startIdentity === "expected" ? startToken : "foreign",
              processGroupId: observedGroupId
            })
            const closed = yield* Effect.exit(app.close)
            expect(Exit.isFailure(closed)).toBe(expectedFailure)
          }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer), Effect.exit)
          expect(Exit.isFailure(result)).toBe(expectedFailure)
        }).pipe(Effect.provide(NodeServices.layer))
      )
  )
)
