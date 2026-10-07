import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import {
  CodexAppServer,
  controlledCodexProcessOwnershipLayer,
  codexAppServerLayer,
  makeNodeCodexProcessGroupCensusService,
  makeNodeCodexProcessOwnershipService
} from "./codex-app-server.js"
import {
  CodexAttemptStore,
  CodexServerIncarnation,
  CodexServerLaunchRecord,
  memoryCodexAttemptStoreLayer,
  nodeCodexAttemptStoreLayer
} from "./codex-attempt-store.js"
import { controlledCodexProcessNativeLayer, type CodexProcessNativeService } from "./codex-process-native.js"

// The private process owner uses memory/filesystem stores. SQLite owns the
// workflow journal, exercised by the separate built public recovery tests.
for (const ownerLane of ["memory", "filesystem"] as const) {
  for (const faultBoundary of ["owned-stat", "token-environ"] as const) {
    it.effect(
      `retained launch ${faultBoundary} EACCES retains exact custody and refuses successor in ${ownerLane}`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-owned-eacces-" })
            const storeLayer =
              ownerLane === "memory"
                ? memoryCodexAttemptStoreLayer()
                : nodeCodexAttemptStoreLayer({ stateDirectory: root })
            const signals: Array<readonly [number, number | NodeJS.Signals]> = []
            const reads: Array<string> = []
            let spawns = 0
            const stat = (pid: number) =>
              `${pid} (codex) S 1 ${pid} ${Array.from({ length: 16 }, () => "0").join(" ")} 123`
            const native: CodexProcessNativeService = {
              platform: "linux",
              pid: 1,
              kill: (pid, signal) => {
                signals.push([pid, signal])
              },
              readFile: async (path) => {
                reads.push(path)
                if (path === "/proc/50/stat")
                  return Promise.reject(
                    Object.assign(
                      new Error(faultBoundary === "owned-stat" ? "controlled owned EACCES" : "prior leader absent"),
                      { code: faultBoundary === "owned-stat" ? "EACCES" : "ENOENT" }
                    )
                  )
                if (path.endsWith("/environ"))
                  return Promise.reject(Object.assign(new Error("controlled owned EACCES"), { code: "EACCES" }))
                if (path.endsWith("/stat")) return stat(path === "/proc/1/stat" ? 1 : 100)
                if (path.endsWith("/status")) return "Uid: 1000 1000 1000 1000\n"
                return "codex\u0000app-server\u0000"
              },
              readdir: async () => ["100"],
              execFile: async () => ({ stdout: "" }),
              wait: () => Effect.void
            }
            const ownership = makeNodeCodexProcessOwnershipService(
              makeNodeCodexProcessGroupCensusService(native),
              native
            )
            const prior = CodexServerLaunchRecord.make({
              command: ["codex", "app-server"],
              incarnation: CodexServerIncarnation.make("owned-eacces|linux%3A123"),
              phase: "Live",
              pid: 50
            })
            const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
            const appLayer = codexAppServerLayer().pipe(
              Layer.provide(controlledCodexProcessNativeLayer(native)),
              Layer.provide(controlledCodexProcessOwnershipLayer(ownership)),
              Layer.provide(
                Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, {
                  ...spawner,
                  spawn: () => {
                    spawns += 1
                    return Effect.die("unsafe successor spawn")
                  }
                })
              )
            )
            yield* Effect.gen(function* () {
              const store = yield* CodexAttemptStore
              yield* store.writeServerLaunch(prior)
              for (const attempt of ownerLane === "memory" ? [1, 2] : [1]) {
                const refusal = yield* Effect.scoped(
                  Effect.gen(function* () {
                    const app = yield* CodexAppServer
                    yield* app.startThread("/never-admitted")
                  }).pipe(Effect.provide(appLayer))
                ).pipe(Effect.result)
                expect(refusal._tag, `fresh reconciliation ${attempt}`).toBe("Failure")
                if (refusal._tag === "Failure")
                  expect(refusal.failure).toMatchObject({
                    _tag: "CodexAppServerFailure",
                    kind: "Ownership",
                    operation: "initialize"
                  })
                if (refusal._tag === "Failure") expect(refusal.failure.detail).toContain("controlled owned EACCES")
                // A mutant that clears the launch or admits a successor cannot pass.
                expect(yield* store.readServerLaunch()).toEqual(Option.some(prior))
                expect(spawns).toBe(0)
                expect(signals.filter(([, signal]) => signal !== 0)).toEqual([])
              }
              expect(reads.filter((path) => path === "/proc/100/environ")).toHaveLength(
                faultBoundary === "owned-stat" ? 0 : ownerLane === "memory" ? 2 : 1
              )
            }).pipe(Effect.provide(storeLayer))
          })
        ).pipe(Effect.provide(NodeCrypto.layer), Effect.provide(NodeServices.layer))
    )
  }
}
