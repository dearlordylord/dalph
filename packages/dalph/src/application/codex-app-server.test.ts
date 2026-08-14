/* eslint-disable import/no-nodejs-modules -- this test launches only a local protocol fixture, never OpenAI. */
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Path } from "effect"
import { expect } from "vitest"
import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  ApplicationExitShell,
  CoordinatorOwnership,
  makeApplicationExitShell
} from "@dalph/orchestrator"
import {
  CodexAppServer,
  CodexAppServerFailure,
  CodexProcessStartIdentity,
  codexAppServerLayer,
  codexAppServerNodeLayer,
  controlledCodexProcessOwnershipLayer
} from "./codex-app-server.js"
import {
  CodexOwnedTurnToken,
  CodexServerIncarnation,
  CodexServerLaunchRecord,
  memoryCodexAttemptStoreLayer
} from "./codex-attempt-store.js"

const fakeServer = String.raw`#!/usr/bin/env node
const fs = require("node:fs")
let buffer = ""
let thread = { id: "fixture-thread", cwd: "/unset", status: "idle", turns: [] }
const persistedThreadFile = process.argv[1] + ".thread"
const write = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
const onMessage = (message) => {
  if (message.method === "initialized") return
  if (message.method === "initialize")
    return write(message.id, {
      userAgent: "fixture-codex/58",
      codexHome: "/tmp/fixture-codex-home",
      platformFamily: "unix",
      platformOs: "linux"
    })
  if (message.method === "thread/start") {
    thread = { ...thread, cwd: message.params.cwd, status: "idle", turns: [] }
    fs.writeFileSync(persistedThreadFile, thread.id)
    return write(message.id, { thread })
  }
  if (message.method === "thread/read" || message.method === "thread/resume") return write(message.id, { thread })
  if (message.method === "turn/start") {
    const inputText = message.params.input?.[0]?.text ?? ""
    const turn = {
      id: "fixture-turn",
      status: "completed",
      items: [
        { type: "userMessage", content: [{ type: "input_text", text: inputText }] },
        { type: "agentMessage", text: "fixture <!-- dalph-owned-turn-token:v1:agent-prose -->" }
      ]
    }
    thread = { ...thread, cwd: message.params.cwd, status: "idle", turns: [turn] }
    return write(message.id, { turn })
  }
  if (message.method === "turn/interrupt") return write(message.id, {})
  if (message.method === "thread/backgroundTerminals/list") return write(message.id, { data: [] })
  if (message.method === "thread/backgroundTerminals/terminate") return write(message.id, { terminated: true })
  return write(message.id, {})
}
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n")
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() !== "") onMessage(JSON.parse(line))
  }
})
`

const malformedInitializationServer = String.raw`#!/usr/bin/env node
let buffer = ""
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
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: "malformed" }) + "\n")
      process.exit(0)
    }
  }
})
`

const contradictoryInitializationServer = String.raw`#!/usr/bin/env node
let buffer = ""
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
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            userAgent: "fixture-codex/58",
            codexHome: "/tmp/fixture-codex-home",
            platformFamily: "windows",
            platformOs: "windows"
          }
        }) + "\n"
      )
    }
  }
})
`

it.effect("speaks the normalized app-server protocol with exact per-call cwd", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)

      const appLayer = codexAppServerNodeLayer({ executable }).pipe(Layer.provide(memoryCodexAttemptStoreLayer()))
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        const thread = yield* app.startThread("/exact/worktree")
        expect(thread.cwd).toBe("/exact/worktree")
        const ownedToken = CodexOwnedTurnToken.make("owned-wire-token")
        const turn = yield* app.startTurn(thread.id, "/exact/worktree", "turn text", ownedToken)
        expect(turn.status).toBe("completed")
        expect(turn.ownedTurnToken).toBe(ownedToken)
        const resumed = yield* app.resumeThread(thread.id, "/exact/worktree")
        expect(resumed.turns).toHaveLength(1)
        expect(resumed.turns[0]?.ownedTurnToken).toBe(ownedToken)
        expect((yield* app.listBackgroundTerminals(thread.id)).length).toBe(0)
        yield* app.close
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer))
      expect(result).toBeUndefined()
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reconciles a surviving prior server incarnation before launching a replacement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-gate-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)
      const prior = CodexServerLaunchRecord.make({
        command: [executable, "app-server"],
        incarnation: CodexServerIncarnation.make("prior-incarnation"),
        phase: "Live",
        pid: 31337
      })
      const observations: Array<string> = []
      let stopped = false
      let observationsAfterStop = 0
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            observe: () =>
              Effect.sync(() => {
                if (stopped) observationsAfterStop += 1
                const isAbsent = stopped && observationsAfterStop >= 2
                observations.push(isAbsent ? "Absent" : "ExactLive")
                return isAbsent ? { _tag: "Absent" as const } : { _tag: "ExactLive" as const, pid: 31337 }
              }),
            discover: () => Effect.succeed({ _tag: "Absent" as const }),
            stop: () =>
              Effect.sync(() => {
                stopped = true
              })
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        yield* app.close
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isSuccess(result)).toBe(true)
      expect(observations).toEqual(["ExactLive", "ExactLive", "Absent", "Absent"])
      expect(stopped).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("supersedes a prior pre-spawn intent only after the application lease is acquired", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-pre-spawn-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)
      const prior = CodexServerLaunchRecord.make({
        command: [executable, "app-server"],
        incarnation: CodexServerIncarnation.make("pre-spawn-intent-58"),
        phase: "Launching",
        pid: null
      })
      let stopped = false
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            observe: () =>
              Effect.succeed(stopped ? { _tag: "Absent" as const } : { _tag: "ExactLive" as const, pid: 1 }),
            discover: () => Effect.succeed({ _tag: "Absent" as const }),
            stop: () => Effect.sync(() => void (stopped = true))
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        yield* app.startThread("/pre-spawn/worktree")
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isSuccess(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("recovers and stops an exact child that survived before PID acknowledgement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-recover-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)
      const prior = CodexServerLaunchRecord.make({
        command: [executable, "app-server"],
        incarnation: CodexServerIncarnation.make("recoverable-spawn-intent-58"),
        phase: "Launching",
        pid: null
      })
      let stopped = false
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            discover: () =>
              Effect.succeed({
                _tag: "ExactLive" as const,
                pid: 31337,
                processIdentity: CodexProcessStartIdentity.make("linux:recoverable-child-58")
              }),
            observe: (target) =>
              Effect.succeed(
                stopped || target.pid === null
                  ? { _tag: "Absent" as const }
                  : { _tag: "ExactLive" as const, pid: target.pid }
              ),
            stop: () => Effect.sync(() => void (stopped = true))
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        yield* app.startThread("/recoverable/worktree")
        yield* app.close
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isSuccess(result)).toBe(true)
      expect(stopped).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed on duplicate, foreign, or unreadable pre-spawn token census", () =>
  Effect.forEach(
    [
      { _tag: "Contradictory" as const, detail: "duplicate exact token" },
      { _tag: "Contradictory" as const, detail: "foreign token" },
      { _tag: "Unreadable" as const, detail: "token census unreadable" }
    ],
    (discovery, index) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const root = yield* fileSystem.makeTempDirectoryScoped({
            prefix: `dalph-issue-58-app-server-discovery-${index}-`
          })
          const executable = path.join(root, "fixture-codex")
          yield* fileSystem.writeFileString(executable, fakeServer)
          yield* fileSystem.chmod(executable, 0o755)
          const prior = CodexServerLaunchRecord.make({
            command: [executable, "app-server"],
            incarnation: CodexServerIncarnation.make(`unrecoverable-spawn-intent-${index}`),
            phase: "Launching",
            pid: null
          })
          const appLayer = codexAppServerLayer({ executable }).pipe(
            Layer.provide(
              controlledCodexProcessOwnershipLayer({
                discover: () => Effect.succeed(discovery),
                observe: () => Effect.succeed({ _tag: "Absent" as const }),
                stop: () => Effect.void
              })
            ),
            Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
          )
          const result = yield* Effect.gen(function* () {
            const app = yield* CodexAppServer
            yield* app.startThread("/unrecoverable/worktree")
          }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
          expect(Exit.isFailure(result)).toBe(true)
        }).pipe(Effect.provide(NodeServices.layer))
      )
  )
)

it.effect("fails closed when initialization decodes to an invalid protocol shape", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-malformed-" })
      const executable = path.join(root, "fixture-codex-malformed")
      yield* fileSystem.writeFileString(executable, malformedInitializationServer)
      yield* fileSystem.chmod(executable, 0o755)
      const appLayer = codexAppServerNodeLayer({ executable }).pipe(Layer.provide(memoryCodexAttemptStoreLayer()))
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        return yield* app.startThread("/exact/worktree")
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails initialization closed when the server identity contradicts the host", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-conflict-" })
      const executable = path.join(root, "fixture-codex-conflict")
      yield* fileSystem.writeFileString(executable, contradictoryInitializationServer)
      yield* fileSystem.chmod(executable, 0o755)
      const appLayer = codexAppServerNodeLayer({ executable }).pipe(Layer.provide(memoryCodexAttemptStoreLayer()))
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        return yield* app.startThread("/exact/worktree")
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("closes the application-scoped server only after the shared executor drain", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-exit-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)

      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void }
      )
      const drainStarted = yield* Deferred.make<void>()
      const secondDrainStarted = yield* Deferred.make<void>()
      const releaseDrain = yield* Deferred.make<void>()
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Deferred.succeed(drainStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseDrain)),
          Effect.as([])
        )
      })
      // Two Run bootstraps register with this one application shell/server.
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Deferred.succeed(secondDrainStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseDrain)),
          Effect.as([])
        )
      })
      const events: Array<string> = []
      let stopped = false
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            observe: () =>
              Effect.succeed(stopped ? { _tag: "Absent" as const } : { _tag: "ExactLive" as const, pid: 1 }),
            discover: () => Effect.succeed({ _tag: "Absent" as const }),
            stop: () =>
              Effect.sync(() => {
                events.push("server-stop")
                stopped = true
              })
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer()),
        Layer.provide(Layer.succeed(ApplicationExitShell, shell))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        const thread = yield* app.startThread("/persisted/worktree")
        const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
        yield* Deferred.await(drainStarted)
        yield* Deferred.await(secondDrainStarted)
        expect((yield* app.readThread(thread.id)).id).toBe(thread.id)
        expect(events).toEqual([])

        yield* Deferred.succeed(releaseDrain, undefined)
        expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
        expect(events).toEqual(["server-stop"])
        expect(yield* fileSystem.readFileString(`${executable}.thread`)).toBe("fixture-thread")

        // Repeated close joins the same application close and never signals a second owner.
        yield* app.close
        const afterClose = yield* Effect.exit(app.startThread("/persisted/worktree"))
        expect(Exit.isFailure(afterClose)).toBe(true)
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isSuccess(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("scope teardown closes the server without claiming an Exit boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-app-server-scope-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)
      const events: Array<string> = []
      let stopped = false
      let processEndRequested = false
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        {
          requestEnd: () =>
            Effect.sync(() => {
              processEndRequested = true
            })
        }
      )
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            observe: () =>
              Effect.succeed(stopped ? { _tag: "Absent" as const } : { _tag: "ExactLive" as const, pid: 1 }),
            discover: () => Effect.succeed({ _tag: "Absent" as const }),
            stop: () =>
              Effect.sync(() => {
                stopped = true
                events.push("server-stop")
              })
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer()),
        Layer.provide(Layer.succeed(ApplicationExitShell, shell))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        yield* app.startThread("/scope-only/worktree")
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isSuccess(result)).toBe(true)
      expect(events).toEqual(["server-stop"])
      expect(processEndRequested).toBe(false)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("keeps startup closed when an existing app-server owner is unreadable or contradictory", () =>
  Effect.forEach(
    [
      { _tag: "Unreadable" as const, detail: "owner census unavailable" },
      { _tag: "Contradictory" as const, detail: "owner incarnation changed" },
      { _tag: "ExactLive" as const, pid: 99_999 }
    ],
    (projection, index) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `dalph-issue-58-owner-fail-${index}-` })
          const executable = path.join(root, "fixture-codex")
          yield* fileSystem.writeFileString(executable, fakeServer)
          yield* fileSystem.chmod(executable, 0o755)
          const prior = CodexServerLaunchRecord.make({
            command: [executable, "app-server"],
            incarnation: CodexServerIncarnation.make(`prior-owner-fail-${index}`),
            phase: "Live",
            pid: 31_337
          })
          const appLayer = codexAppServerLayer({ executable }).pipe(
            Layer.provide(
              controlledCodexProcessOwnershipLayer({
                observe: (target) =>
                  Effect.succeed("processIdentity" in target ? { _tag: "ExactLive" as const, pid: 1 } : projection),
                discover: () => Effect.succeed({ _tag: "Absent" as const }),
                stop: () => Effect.void
              })
            ),
            Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
          )
          const result = yield* Effect.gen(function* () {
            const app = yield* CodexAppServer
            yield* Effect.exit(app.startThread("/owner-fail/worktree"))
          }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
          expect(Exit.isSuccess(result)).toBe(true)
        }).pipe(Effect.provide(NodeServices.layer))
      )
  )
)

it.effect("does not stop a prior app-server already observed absent", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-owner-absent-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)
      const prior = CodexServerLaunchRecord.make({
        command: [executable, "app-server"],
        incarnation: CodexServerIncarnation.make("prior-owner-absent"),
        phase: "Live",
        pid: 31_337
      })
      let stopCalls = 0
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            observe: (target) =>
              Effect.succeed(
                "processIdentity" in target ? { _tag: "ExactLive" as const, pid: 1 } : { _tag: "Absent" as const }
              ),
            discover: () => Effect.succeed({ _tag: "Absent" as const }),
            stop: () => Effect.sync(() => void (stopCalls += 1))
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        yield* app.startThread("/owner-absent/worktree")
        yield* app.close
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isSuccess(result)).toBe(true)
      expect(stopCalls).toBe(1)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed when a prior app-server cannot be stopped or never becomes absent", () =>
  Effect.forEach(
    [
      { stop: true, afterStop: { _tag: "ExactLive" as const, pid: 31_337 } },
      { stop: false, afterStop: { _tag: "Unreadable" as const, detail: "owner reread failed" } },
      { stop: false, afterStop: { _tag: "Contradictory" as const, detail: "owner changed" } }
    ],
    (behavior, index) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: `dalph-issue-58-owner-stop-${index}-` })
          const executable = path.join(root, "fixture-codex")
          yield* fileSystem.writeFileString(executable, fakeServer)
          yield* fileSystem.chmod(executable, 0o755)
          const prior = CodexServerLaunchRecord.make({
            command: [executable, "app-server"],
            incarnation: CodexServerIncarnation.make(`prior-owner-stop-${index}`),
            phase: "Live",
            pid: 31_337
          })
          let stopped = false
          const appLayer = codexAppServerLayer({ executable }).pipe(
            Layer.provide(
              controlledCodexProcessOwnershipLayer({
                observe: (target) => {
                  if ("processIdentity" in target) return Effect.succeed({ _tag: "ExactLive" as const, pid: 1 })
                  return Effect.succeed(stopped ? behavior.afterStop : { _tag: "ExactLive" as const, pid: 31_337 })
                },
                discover: () => Effect.succeed({ _tag: "Absent" as const }),
                stop: () =>
                  behavior.stop
                    ? Effect.sync(() => void (stopped = true))
                    : Effect.fail(
                        new CodexAppServerFailure({ operation: "close", kind: "Ownership", detail: "stop rejected" })
                      )
              })
            ),
            Layer.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: prior }))
          )
          const result = yield* Effect.gen(function* () {
            const app = yield* CodexAppServer
            const started = yield* Effect.exit(app.startThread("/owner-stop/worktree"))
            expect(Exit.isFailure(started)).toBe(true)
          }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
          expect(Exit.isSuccess(result)).toBe(true)
        }).pipe(Effect.provide(NodeServices.layer))
      )
  )
)

it.effect("reports executor drain failure while still attempting app-server cleanup", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-exit-executor-fail-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void }
      )
      yield* shell.registerExecutorDrain({
        suspendRunningExecutorWork: Effect.fail(
          new ApplicationExitDrainFailure({ diagnostics: [ApplicationExitDiagnostic.make("executor failed")] })
        )
      })
      let stopped = false
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            observe: (target) =>
              Effect.succeed(
                "processIdentity" in target
                  ? { _tag: "ExactLive" as const, pid: 1 }
                  : stopped
                    ? { _tag: "Absent" as const }
                    : { _tag: "ExactLive" as const, pid: 1 }
              ),
            discover: () => Effect.succeed({ _tag: "Absent" as const }),
            stop: () => Effect.sync(() => void (stopped = true))
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer()),
        Layer.provide(Layer.succeed(ApplicationExitShell, shell))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        yield* app.startThread("/exit-executor-fail/worktree")
        const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
        const exit = yield* Fiber.join(exiting).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(stopped).toBe(true)
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reports process-local app-server cleanup failure through the Exit boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-exit-close-fail-" })
      const executable = path.join(root, "fixture-codex")
      yield* fileSystem.writeFileString(executable, fakeServer)
      yield* fileSystem.chmod(executable, 0o755)
      const shell = yield* makeApplicationExitShell(
        CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation }),
        { requestEnd: () => Effect.void }
      )
      yield* shell.registerExecutorDrain({ suspendRunningExecutorWork: Effect.succeed([]) })
      let stopCalls = 0
      const appLayer = codexAppServerLayer({ executable }).pipe(
        Layer.provide(
          controlledCodexProcessOwnershipLayer({
            observe: (target) =>
              Effect.succeed(
                "processIdentity" in target
                  ? { _tag: "ExactLive" as const, pid: 1 }
                  : { _tag: "ExactLive" as const, pid: 1 }
              ),
            discover: () => Effect.succeed({ _tag: "Absent" as const }),
            stop: () =>
              Effect.sync(() => void (stopCalls += 1)).pipe(
                Effect.andThen(
                  Effect.fail(
                    new CodexAppServerFailure({ operation: "close", kind: "Ownership", detail: "cleanup failed" })
                  )
                )
              )
          })
        ),
        Layer.provide(memoryCodexAttemptStoreLayer()),
        Layer.provide(Layer.succeed(ApplicationExitShell, shell))
      )
      const result = yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        yield* app.startThread("/exit-close-fail/worktree")
        const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
        const exit = yield* Fiber.join(exiting).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(stopCalls).toBeGreaterThan(0)
      }).pipe(Effect.provide(appLayer), Effect.provide(NodeServices.layer), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
