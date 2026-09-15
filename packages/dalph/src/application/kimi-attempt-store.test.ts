import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { AttemptId, GitCommitSha, RunId, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import { Effect, Exit, FileSystem, Layer, Option, Path } from "effect"
import { expect } from "vitest"
import type { KimiAttemptPrivatePhase } from "./kimi-attempt-store.js"
import {
  KimiAttemptPrivateRecord,
  KimiAttemptPrivateStore,
  nodeKimiAttemptPrivateStoreLayer
} from "./kimi-attempt-store.js"
import { KimiAcpSessionId } from "./kimi-acp.js"

const runId = RunId.make("run:kimi-private-store")
const attemptId = AttemptId.make("attempt:kimi-private-store")
const record = KimiAttemptPrivateRecord.make({
  attemptId,
  baseSha: GitCommitSha.make("1".repeat(40)),
  executor: TaskExecutorLocator.make("executor:kimi/for-coding"),
  phase: "Executing" satisfies KimiAttemptPrivatePhase,
  runId,
  sessionId: KimiAcpSessionId.make("kimi-session-private-store"),
  worktree: WorktreeLocator.make("/worktrees/kimi-private-store"),
  sessionClosed: false
})

const layerAt = (stateDirectory: string) =>
  nodeKimiAttemptPrivateStoreLayer({ stateDirectory }).pipe(Layer.provide(NodeServices.layer))

it.effect("reopens the exact Kimi session association without persisting credentials or ACP messages", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-kimi-private-store-" })
      const filename = path.join(root, "kimi-executor-private-state.json")

      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        yield* store.write(record)
      }).pipe(Effect.provide(layerAt(root)))

      const encoded = yield* fileSystem.readFileString(filename)
      expect(encoded).toContain("kimi-session-private-store")
      expect(encoded).not.toContain("credential")
      expect(encoded).not.toContain("jsonrpc")

      yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        const recovered = yield* store.read(runId, attemptId)
        expect(Option.isSome(recovered) && recovered.value).toEqual(record)
      }).pipe(Effect.provide(layerAt(root)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed when Kimi private state is malformed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-kimi-private-store-malformed-" })
      const filename = path.join(root, "kimi-executor-private-state.json")
      yield* fileSystem.writeFileString(filename, "not-json", { mode: 0o600 })
      yield* fileSystem.chmod(filename, 0o600)
      const result = yield* Effect.gen(function* () {
        const store = yield* KimiAttemptPrivateStore
        return yield* store.read(runId, attemptId)
      }).pipe(Effect.provide(layerAt(root)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(result.cause).toBeDefined()
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed when another process owns the Kimi private-store lease", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-kimi-private-store-lease-" })
      yield* Layer.build(layerAt(root))
      const result = yield* Layer.build(layerAt(root)).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(result.cause).toBeDefined()
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
