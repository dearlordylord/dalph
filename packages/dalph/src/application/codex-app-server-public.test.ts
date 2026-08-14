/* eslint-disable import/no-nodejs-modules -- these tests exercise the execution-substrate public boundary. */
import nodeProcess from "node:process"
import { spawn } from "node:child_process"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Effect, Exit, FileSystem, Layer, Option, Path } from "effect"
import { expect } from "vitest"
import {
  CodexAppServer,
  CodexAppServerFailure,
  type CodexBackgroundTerminal,
  CodexOwnedActivityCensus,
  CodexProcessStartIdentity,
  controlledCodexAppServerLayer,
  controlledCodexOwnedActivityCensusLayer,
  codexAppServerNodeLayer,
  nodeCodexOwnedActivityCensusLayer,
  type CodexAppServerService,
  type CodexOwnedActivityCensusProjection,
  type CodexOwnedProcessIdentity,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import {
  CodexThreadId,
  CodexTurnId,
  CodexServerIncarnation,
  CodexServerLaunchRecord,
  memoryCodexAttemptStoreLayer
} from "./codex-attempt-store.js"

const thread = (
  status: CodexThreadSnapshot["status"],
  turns: ReadonlyArray<CodexTurnSnapshot>
): CodexThreadSnapshot => ({ id: CodexThreadId.make("public-thread"), cwd: "/public/worktree", status, turns })

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

const discoveryFixture = String.raw`#!/usr/bin/env node
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
    if (message.method === "initialize") {
      write(message.id, { userAgent: "fixture", codexHome: "/tmp/fixture", platformFamily: "unix", platformOs: "linux" })
    } else if (message.method === "thread/start") {
      write(message.id, { thread: { id: "discovery-thread", cwd: message.params.cwd, status: "idle", turns: [] } })
    } else {
      write(message.id, {})
    }
  }
})
setInterval(() => {}, 1000)
`

type OwnedActivityCensusService = {
  readonly observe: (
    thread: CodexThreadSnapshot,
    backgroundTerminals: ReadonlyArray<CodexBackgroundTerminal>
  ) => Effect.Effect<CodexOwnedActivityCensusProjection, CodexAppServerFailure>
  readonly terminateDescendants: (
    descendants: ReadonlyArray<CodexOwnedProcessIdentity>
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
      startThread: (cwd: string) =>
        Effect.succeed(thread("idle", [] as const) as CodexThreadSnapshot).pipe(
          Effect.map((value) => ({ ...value, cwd }))
        ),
      readThread: () => Effect.succeed(thread("idle", [] as const)),
      resumeThread: (threadId: CodexThreadId, cwd: string) =>
        Effect.succeed({ ...thread("idle", [] as const), id: threadId, cwd }),
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
    const absent = yield* runCensus((census) => census.observe(thread("idle", []), [])).pipe(
      Effect.provide(nodeCodexOwnedActivityCensusLayer)
    )
    expect(absent).toEqual({ _tag: "Absent" })

    const activeWithoutTurn = yield* runCensus((census) => census.observe(thread("active", []), [])).pipe(
      Effect.provide(nodeCodexOwnedActivityCensusLayer)
    )
    expect(activeWithoutTurn._tag).toBe("Contradictory")

    const multipleTurns = yield* runCensus((census) =>
      census.observe(thread("idle", [turn("one", "inProgress"), turn("two", "inProgress")]), [])
    ).pipe(Effect.provide(nodeCodexOwnedActivityCensusLayer))
    expect(multipleTurns._tag).toBe("Contradictory")

    const background = yield* runCensus((census) =>
      census.observe(thread("idle", [turn("done", "completed")]), [terminal(null)])
    ).pipe(Effect.provide(nodeCodexOwnedActivityCensusLayer))
    expect(background).toMatchObject({ _tag: "ExactLive", activities: [{ _tag: "BackgroundTerminal" }] })

    const processBacked = yield* runCensus((census) =>
      census.observe(thread("idle", []), [terminal(nodeProcess.pid)])
    ).pipe(Effect.provide(nodeCodexOwnedActivityCensusLayer))
    expect(processBacked._tag).toBe("ExactLive")
    if (processBacked._tag === "ExactLive") {
      expect(processBacked.activities.some((activity) => activity._tag === "ProcessGroupDescendant")).toBe(true)
    }
  })
)

it.effect("revalidates exact descendant identities before stopping owned activity", () =>
  Effect.gen(function* () {
    const census = yield* CodexOwnedActivityCensus.pipe(Effect.provide(nodeCodexOwnedActivityCensusLayer))
    yield* census.terminateDescendants([
      {
        pid: 999_999_999,
        parentPid: 1,
        processGroupId: 1,
        startIdentity: CodexProcessStartIdentity.make("linux:missing")
      }
    ])

    const changed = yield* census
      .terminateDescendants([
        {
          pid: nodeProcess.pid,
          parentPid: 1,
          processGroupId: 1,
          startIdentity: CodexProcessStartIdentity.make("linux:foreign")
        }
      ])
      .pipe(Effect.exit)
    expect(Exit.isFailure(changed)).toBe(true)
  })
)

it.effect("keeps unsupported host process census fail-closed", () => {
  const originalPlatform = nodeProcess.platform
  Object.defineProperty(nodeProcess, "platform", { configurable: true, value: "darwin" })
  return Effect.gen(function* () {
    const census = yield* CodexOwnedActivityCensus
    const observed = yield* census.observe(thread("idle", []), [terminal(nodeProcess.pid)])
    expect(observed).toEqual({
      _tag: "Unreadable",
      detail: "owned attempt process census is not qualified on this host"
    })
  }).pipe(
    Effect.provide(nodeCodexOwnedActivityCensusLayer),
    Effect.ensuring(
      Effect.sync(() => Object.defineProperty(nodeProcess, "platform", { configurable: true, value: originalPlatform }))
    )
  )
})

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
        env: { ...nodeProcess.env, DALPH_CODEX_SERVER_INCARNATION: token },
        stdio: "ignore"
      })
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
      const layer = codexAppServerNodeLayer({ executable }).pipe(
        Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
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
              expect(failure.value.detail).toMatch(/different launch token|not qualified|cannot observe/)
            }
          }
        }
      }).pipe(Effect.provide(layer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isSuccess(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
