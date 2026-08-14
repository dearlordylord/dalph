import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  PlannedTaskAttempt
} from "@dalph/contracts"
import { ConfigProvider, Effect, Exit, FileSystem, Layer, Option, Path } from "effect"
import { expect } from "vitest"
import {
  CodexAttemptRecord,
  CodexAttemptStore,
  CodexProcessIdentity,
  CodexServerIncarnation,
  CodexServerLeaseIncarnation,
  CodexServerLeaseRecord,
  CodexServerLaunchRecord,
  CodexThreadId,
  defaultCodexStateDirectory,
  nodeCodexAttemptStoreLayer
} from "./codex-attempt-store.js"

const specification = makeTaskWorkSpecification({
  body: "Private store test",
  taskId: TaskId.make("issue-58-store-task"),
  title: "Issue 58 private store"
})
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:issue-58-store:0"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/issue-58-store"),
  executor: TaskExecutorLocator.make("executor:codex-app-server"),
  runId: RunId.make("run:issue-58-store"),
  taskId: TaskId.make("issue-58-store-task"),
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/tmp/dalph-issue-58-store-worktree")
})
const associated = CodexAttemptRecord.cases.AssociatedPreTurn.make({
  attemptId: attempt.attemptId,
  correlationAttemptId: attempt.attemptId,
  correlationRunId: attempt.runId,
  threadId: CodexThreadId.make("private-thread-58"),
  worktree: attempt.worktree
})
const launch = CodexServerLaunchRecord.make({
  command: ["codex", "app-server"],
  incarnation: CodexServerIncarnation.make("private-incarnation-58"),
  phase: "Live",
  pid: 12345
})
const leaseOwner = CodexServerLeaseRecord.make({
  pid: 12345,
  processIdentity: CodexProcessIdentity.make("test-process-start-58"),
  incarnation: CodexServerLeaseIncarnation.make("test-lease-incarnation-58")
})
const otherLeaseOwner = CodexServerLeaseRecord.make({
  pid: 12346,
  processIdentity: CodexProcessIdentity.make("other-process-start-58"),
  incarnation: CodexServerLeaseIncarnation.make("other-lease-incarnation-58")
})

const nodeLayer = (storePath: string) =>
  nodeCodexAttemptStoreLayer({ stateDirectory: storePath.slice(0, storePath.lastIndexOf("/")) }).pipe(
    Layer.provide(NodeServices.layer)
  )

const writePrivateFile = (fileSystem: FileSystem.FileSystem, filename: string, contents: string) =>
  fileSystem
    .writeFileString(filename, contents, { mode: 0o600 })
    .pipe(Effect.andThen(fileSystem.chmod(filename, 0o600)))

it.effect("survives an application restart with the exact private association and server launch", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-" })
      const storePath = path.join(root, "executor-private-state.json")

      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          yield* store.writeAttempt(associated)
          yield* store.writeServerLaunch(launch)
        }).pipe(Effect.provide(nodeLayer(storePath)))
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          const readAttempt = yield* store.readAttempt(attempt.runId, attempt.attemptId)
          const readLaunch = yield* store.readServerLaunch()
          expect(Option.isSome(readAttempt) && readAttempt.value).toEqual(associated)
          expect(Option.isSome(readLaunch) && readLaunch.value).toEqual(launch)
        }).pipe(Effect.provide(nodeLayer(storePath)))
      )
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("durably records a spawned child before process identity reconciliation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-spawned-" })
      const storePath = path.join(root, "executor-private-state.json")
      const spawned = CodexServerLaunchRecord.make({
        command: ["codex", "app-server"],
        incarnation: CodexServerIncarnation.make("spawned-incarnation-58"),
        phase: "Spawned",
        pid: 54321
      })
      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        yield* store.writeServerLaunch(spawned)
        const read = yield* store.readServerLaunch()
        expect(Option.isSome(read) && read.value).toEqual(spawned)
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("admits only one independent filesystem store lease", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-lease-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* Effect.gen(function* () {
        const first = yield* CodexAttemptStore
        yield* first.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
        const second = yield* Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          return yield* store.acquireServerLease(otherLeaseOwner, () => Effect.succeed({ _tag: "ExactLive" as const }))
        }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
        expect(Exit.isFailure(second)).toBe(true)
        yield* first.releaseServerLease(leaseOwner)
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reclaims an exact stale lease but never releases a foreign owner", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-lease-reclaim-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* writePrivateFile(fileSystem, `${storePath}.lease`, JSON.stringify(otherLeaseOwner))
      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
        const foreignRelease = yield* store.releaseServerLease(otherLeaseOwner).pipe(Effect.exit)
        expect(Exit.isFailure(foreignRelease)).toBe(true)
        yield* store.releaseServerLease(leaseOwner)
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed for a live or unreadable persisted lease", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-lease-fail-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* writePrivateFile(fileSystem, `${storePath}.lease`, JSON.stringify(otherLeaseOwner))
      const live = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "ExactLive" as const }))
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(live)).toBe(true)

      yield* writePrivateFile(fileSystem, `${storePath}.lease`, "not-json")
      const unreadable = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(unreadable)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed when the private snapshot is malformed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-corrupt-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* writePrivateFile(fileSystem, storePath, "{not-json")
      const result = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.readAttempt(attempt.runId, attempt.attemptId)
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("does not upcast a legacy flat attempt record", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-legacy-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* writePrivateFile(
        fileSystem,
        storePath,
        JSON.stringify({
          attempts: [
            {
              attemptId: attempt.attemptId,
              correlationAttemptId: attempt.attemptId,
              correlationRunId: attempt.runId,
              evidenceManifest: null,
              phase: "AssociatedPreTurn",
              terminal: null,
              threadId: CodexThreadId.make("private-thread-legacy"),
              turnId: null,
              turnMayHaveStarted: false,
              worktree: attempt.worktree
            }
          ],
          serverLaunch: null
        })
      )
      const result = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.readAttempt(attempt.runId, attempt.attemptId)
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("recovers a complete legacy next snapshot after an interrupted write", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-next-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* writePrivateFile(
        fileSystem,
        `${storePath}.next`,
        JSON.stringify({ attempts: [associated], serverLaunch: launch })
      )
      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        const readAttempt = yield* store.readAttempt(attempt.runId, attempt.attemptId)
        const readLaunch = yield* store.readServerLaunch()
        expect(Option.isSome(readAttempt) && readAttempt.value).toEqual(associated)
        expect(Option.isSome(readLaunch) && readLaunch.value).toEqual(launch)
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed on duplicate private attempt correlations", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-duplicate-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* writePrivateFile(
        fileSystem,
        storePath,
        JSON.stringify({ attempts: [associated, associated], serverLaunch: null })
      )
      const result = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.readAttempt(attempt.runId, attempt.attemptId)
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed when one Codex thread is aliased to multiple attempts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-alias-" })
      const storePath = path.join(root, "executor-private-state.json")
      const second = CodexAttemptRecord.make({
        ...associated,
        attemptId: AttemptId.make("attempt:issue-58-store:1"),
        correlationAttemptId: AttemptId.make("attempt:issue-58-store:1")
      })
      yield* writePrivateFile(
        fileSystem,
        storePath,
        JSON.stringify({ attempts: [associated, second], serverLaunch: null })
      )
      const result = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.readAttempt(attempt.runId, attempt.attemptId)
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("rejects a same-process executor alias before persisting the resulting snapshot", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-write-alias-" })
      const storePath = path.join(root, "executor-private-state.json")
      const second = CodexAttemptRecord.make({
        ...associated,
        attemptId: AttemptId.make("attempt:issue-58-store:write-alias"),
        correlationAttemptId: AttemptId.make("attempt:issue-58-store:write-alias")
      })
      const result = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        yield* store.writeAttempt(associated)
        return yield* store.writeAttempt(second)
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      const persisted = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.readAttempt(attempt.runId, attempt.attemptId)
      }).pipe(Effect.provide(nodeLayer(storePath)))
      expect(Option.isSome(persisted)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("rejects relative and traversal state directories before filesystem access", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const relative = yield* Effect.gen(function* () {
        yield* CodexAttemptStore
        return true
      }).pipe(Effect.provide(nodeCodexAttemptStoreLayer({ stateDirectory: "relative/private" })), Effect.exit)
      const traversal = yield* Effect.gen(function* () {
        yield* CodexAttemptStore
        return true
      }).pipe(Effect.provide(nodeCodexAttemptStoreLayer({ stateDirectory: "/tmp/../private" })), Effect.exit)
      expect(Exit.isFailure(relative)).toBe(true)
      expect(Exit.isFailure(traversal)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("creates and verifies owner-only private directory and snapshot permissions", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-mode-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        yield* store.writeAttempt(associated)
      }).pipe(Effect.provide(nodeLayer(storePath)))
      const directoryInfo = yield* fileSystem.stat(root)
      const fileInfo = yield* fileSystem.stat(storePath)
      expect(directoryInfo.mode & 0o077).toBe(0)
      expect(fileInfo.mode & 0o077).toBe(0)
      expect(fileInfo.mode & 0o777).toBe(0o600)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed for a symlink or foreign-permission private file", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-path-" })
      const symlinkPath = path.join(root, "executor-private-state.json")
      const target = path.join(root, "foreign-target.json")
      yield* writePrivateFile(fileSystem, target, JSON.stringify({ attempts: [], serverLaunch: null }))
      yield* fileSystem.symlink(target, symlinkPath)
      const symlinkResult = yield* Effect.gen(function* () {
        yield* CodexAttemptStore
        return true
      }).pipe(Effect.provide(nodeLayer(symlinkPath)), Effect.exit)
      expect(Exit.isFailure(symlinkResult)).toBe(true)

      const foreignRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-foreign-" })
      const foreignPath = path.join(foreignRoot, "executor-private-state.json")
      yield* fileSystem.writeFileString(foreignPath, JSON.stringify({ attempts: [], serverLaunch: null }), {
        mode: 0o644
      })
      const foreignResult = yield* Effect.gen(function* () {
        yield* CodexAttemptStore
        return true
      }).pipe(Effect.provide(nodeLayer(foreignPath)), Effect.exit)
      expect(Exit.isFailure(foreignResult)).toBe(true)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed when a private snapshot path is swapped to a symlink before descriptor write", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-symlink-swap-" })
      const storePath = path.join(root, "executor-private-state.json")
      const target = path.join(root, "unowned-target.json")
      yield* writePrivateFile(fileSystem, target, "unchanged")

      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        yield* fileSystem.remove(storePath)
        yield* fileSystem.symlink(target, storePath)

        const result = yield* store.writeAttempt(associated).pipe(Effect.exit)
        expect(Exit.isFailure(result)).toBe(true)
        expect(yield* fileSystem.readFileString(target)).toBe("unchanged")
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reads the configured default state directory through Effect Config", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-config-" })
      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        yield* store.writeAttempt(associated)
      }).pipe(
        Effect.provide(nodeCodexAttemptStoreLayer()),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_STATE_DIRECTORY: root }))),
        Effect.provide(NodeServices.layer)
      )
      const state = yield* fileSystem.stat(`${root}/executor-private-state.json`)
      expect(state.mode & 0o777).toBe(0o600)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("keeps the production default under the explicit Dalph state directory", () => {
  expect(defaultCodexStateDirectory).toBe("/var/lib/dalph")
  return Effect.succeed(undefined)
})
