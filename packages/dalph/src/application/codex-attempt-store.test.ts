import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  PlannedTaskAttempt
} from "@dalph/contracts"
import { ConfigProvider, Crypto, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect"
import { expect } from "vitest"
import {
  CodexAttemptRecord,
  CodexAttemptStore,
  CodexOwnedTurnToken,
  CodexPurgedWorkUnitEvidence,
  CodexPurgedWorkUnitReplacementLedger,
  CodexReplacementHistoryEntry,
  CodexReplacementOperationId,
  CodexReplacementRequestDigest,
  CodexReplacementRequestId,
  CodexSealedTerminal,
  CodexProcessIdentity,
  CodexServerIncarnation,
  CodexServerLeaseIncarnation,
  CodexServerLeaseRecord,
  CodexServerLaunchRecord,
  CodexThreadId,
  CodexTurnId,
  defaultCodexStateDirectory,
  memoryCodexAttemptStoreLayer,
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
        yield* first.acquireServerLease(leaseOwner, () => Effect.die("same owner must not observe"))
        const sameProcessConflict = yield* first
          .acquireServerLease(otherLeaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
          .pipe(Effect.exit)
        expect(Exit.isFailure(sameProcessConflict)).toBe(true)
        const second = yield* Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          return yield* store.acquireServerLease(otherLeaseOwner, () => Effect.succeed({ _tag: "ExactLive" as const }))
        }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
        expect(Exit.isFailure(second)).toBe(true)
        const lockedAbsent = yield* Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          return yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
        }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
        expect(Exit.isFailure(lockedAbsent)).toBe(true)
        const lockedContradictory = yield* Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          return yield* store.acquireServerLease(leaseOwner, () =>
            Effect.succeed({ _tag: "Contradictory", detail: "locked owner disagrees" } as const)
          )
        }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
        expect(Exit.isFailure(lockedContradictory)).toBe(true)
        yield* first.releaseServerLease(leaseOwner)
        yield* first.releaseServerLease(leaseOwner)
        const sameOwner = yield* Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "ExactLive" as const }))
          yield* store.releaseServerLease(leaseOwner)
        }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
        expect(Exit.isSuccess(sameOwner)).toBe(true)
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

      yield* writePrivateFile(fileSystem, `${storePath}.lease`, JSON.stringify(otherLeaseOwner))
      const unobservableOwner = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.acquireServerLease(leaseOwner, () =>
          Effect.succeed({ _tag: "Unreadable", detail: "owner observation unavailable" } as const)
        )
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(unobservableOwner)).toBe(true)
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
          serverLaunch: null,
          replacements: []
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
        JSON.stringify({ attempts: [associated], serverLaunch: launch, replacements: [] })
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
        JSON.stringify({ attempts: [associated, associated], serverLaunch: null, replacements: [] })
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
        JSON.stringify({ attempts: [associated, second], serverLaunch: null, replacements: [] })
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

it.effect("treats an empty private snapshot as a fresh store", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-empty-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* writePrivateFile(fileSystem, storePath, "")
      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        expect(yield* store.readAttempt(attempt.runId, attempt.attemptId)).toEqual(Option.none())
        expect(yield* store.readServerLaunch()).toEqual(Option.none())
        yield* store.writeAttempt(associated)
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("reports a locked lease with no readable owner instead of reclaiming it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-empty-lease-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* Effect.gen(function* () {
        const first = yield* CodexAttemptStore
        yield* first.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
        yield* fileSystem.writeFileString(`${storePath}.lease`, "", { mode: 0o600 })
        const second = yield* Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          return yield* store.acquireServerLease(otherLeaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
        }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
        expect(Exit.isFailure(second)).toBe(true)
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("fails closed for unsafe private directories and every sidecar file kind", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-shapes-" })
      const expectLayerFailure = (stateDirectory: string) =>
        Effect.gen(function* () {
          yield* CodexAttemptStore
          return true
        }).pipe(Effect.provide(nodeCodexAttemptStoreLayer({ stateDirectory })), Effect.exit)

      const rootFailure = yield* expectLayerFailure(path.parse(root).root)
      expect(Exit.isFailure(rootFailure)).toBe(true)

      const regularPath = path.join(root, "not-a-directory")
      yield* fileSystem.writeFileString(regularPath, "regular")
      const regularDirectory = yield* expectLayerFailure(regularPath)
      expect(Exit.isFailure(regularDirectory)).toBe(true)

      const directoryTarget = path.join(root, "directory-target")
      const directoryLink = path.join(root, "directory-link")
      yield* fileSystem.makeDirectory(directoryTarget)
      yield* fileSystem.symlink(directoryTarget, directoryLink)
      const symlinkDirectory = yield* expectLayerFailure(directoryLink)
      expect(Exit.isFailure(symlinkDirectory)).toBe(true)

      const modeDirectory = path.join(root, "mode-directory")
      yield* fileSystem.makeDirectory(modeDirectory, { recursive: true, mode: 0o755 })
      yield* fileSystem.chmod(modeDirectory, 0o755)
      const unsafeMode = yield* expectLayerFailure(modeDirectory)
      expect(Exit.isFailure(unsafeMode)).toBe(true)

      const mainState = path.join(root, "main-state")
      const mainDirectory = path.join(mainState, "executor-private-state.json")
      yield* fileSystem.makeDirectory(mainState)
      yield* fileSystem.chmod(mainState, 0o700)
      yield* fileSystem.makeDirectory(mainDirectory)
      const nonRegularMain = yield* expectLayerFailure(mainState)
      expect(Exit.isFailure(nonRegularMain)).toBe(true)

      const temporaryState = path.join(root, "temporary-state")
      const temporaryStore = path.join(temporaryState, "executor-private-state.json")
      yield* fileSystem.makeDirectory(temporaryState)
      yield* fileSystem.chmod(temporaryState, 0o700)
      yield* fileSystem.makeDirectory(`${temporaryStore}.next`)
      const nonRegularTemporary = yield* expectLayerFailure(temporaryState)
      expect(Exit.isFailure(nonRegularTemporary)).toBe(true)

      const leaseState = path.join(root, "lease-state")
      const leaseStore = path.join(leaseState, "executor-private-state.json")
      yield* fileSystem.makeDirectory(leaseState)
      yield* fileSystem.chmod(leaseState, 0o700)
      yield* fileSystem.makeDirectory(`${leaseStore}.lease`)
      const nonRegularLease = yield* expectLayerFailure(leaseState)
      expect(Exit.isFailure(nonRegularLease)).toBe(true)

      const sidecarTarget = path.join(root, "sidecar-target")
      yield* writePrivateFile(fileSystem, sidecarTarget, "sidecar")
      const symlinkTemporaryState = path.join(root, "symlink-temporary-state")
      const symlinkStore = path.join(symlinkTemporaryState, "executor-private-state.json")
      yield* fileSystem.makeDirectory(symlinkTemporaryState)
      yield* fileSystem.chmod(symlinkTemporaryState, 0o700)
      yield* fileSystem.symlink(sidecarTarget, `${symlinkStore}.next`)
      const symlinkTemporary = yield* expectLayerFailure(symlinkTemporaryState)
      expect(Exit.isFailure(symlinkTemporary)).toBe(true)

      const symlinkLeaseState = path.join(root, "symlink-lease-state")
      const symlinkLeaseStore = path.join(symlinkLeaseState, "executor-private-state.json")
      yield* fileSystem.makeDirectory(symlinkLeaseState)
      yield* fileSystem.chmod(symlinkLeaseState, 0o700)
      yield* fileSystem.symlink(sidecarTarget, `${symlinkLeaseStore}.lease`)
      const symlinkLease = yield* expectLayerFailure(symlinkLeaseState)
      expect(Exit.isFailure(symlinkLease)).toBe(true)
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
      yield* writePrivateFile(
        fileSystem,
        target,
        JSON.stringify({ attempts: [], serverLaunch: null, replacements: [] })
      )
      yield* fileSystem.symlink(target, symlinkPath)
      const symlinkResult = yield* Effect.gen(function* () {
        yield* CodexAttemptStore
        return true
      }).pipe(Effect.provide(nodeLayer(symlinkPath)), Effect.exit)
      expect(Exit.isFailure(symlinkResult)).toBe(true)

      const foreignRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-foreign-" })
      const foreignPath = path.join(foreignRoot, "executor-private-state.json")
      yield* fileSystem.writeFileString(
        foreignPath,
        JSON.stringify({ attempts: [], serverLaunch: null, replacements: [] }),
        { mode: 0o644 }
      )
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

it.effect("retains a typed persistence failure after a sidecar becomes non-regular", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-sidecar-race-" })
      const storePath = path.join(root, "executor-private-state.json")

      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        expect(yield* store.readAttempt(attempt.runId, attempt.attemptId)).toEqual(Option.none())
        yield* fileSystem.makeDirectory(`${storePath}.next`)
        const write = yield* store.writeAttempt(associated).pipe(Effect.exit)
        expect(Exit.isFailure(write)).toBe(true)
        yield* fileSystem.remove(`${storePath}.next`, { recursive: true })
        const read = yield* store.readAttempt(attempt.runId, attempt.attemptId).pipe(Effect.exit)
        expect(Exit.isFailure(read)).toBe(true)
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("replays the newest complete checksummed snapshot after torn and invalid append records", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-checksum-" })
      const storePath = path.join(root, "executor-private-state.json")
      const payload = JSON.stringify({ attempts: [associated], serverLaunch: launch, replacements: [] })
      const crypto = yield* Crypto.Crypto
      const digestBytes = yield* crypto.digest("SHA-256", new TextEncoder().encode(payload))
      const digest = Array.from(digestBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
      const valid = JSON.stringify({ digest, formatVersion: 1, payload })
      const noVersion = JSON.stringify({ payload })
      const invalidPayload = JSON.stringify({ digest: "", formatVersion: 1, payload: 42 })
      const invalidDigest = JSON.stringify({ digest: "0".repeat(64), formatVersion: 1, payload })
      yield* writePrivateFile(
        fileSystem,
        storePath,
        `${valid}\n${noVersion}\n${invalidPayload}\n${invalidDigest}\nnull\nnot-json\n`
      )

      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        expect(yield* store.readAttempt(attempt.runId, attempt.attemptId)).toEqual(Option.some(associated))
        expect(yield* store.readServerLaunch()).toEqual(Option.some(launch))
        yield* store.clearServerLaunch(CodexServerIncarnation.make("foreign-incarnation"))
        expect(yield* store.readServerLaunch()).toEqual(Option.some(launch))
        yield* store.clearServerLaunch(launch.incarnation)
        expect(yield* store.readServerLaunch()).toEqual(Option.none())
      }).pipe(Effect.provide(nodeLayer(storePath)))
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("retains a typed load failure for every later operation after no snapshot record is readable", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-load-failure-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* writePrivateFile(
        fileSystem,
        storePath,
        JSON.stringify({ digest: "0".repeat(64), formatVersion: 1, payload: "not-a-snapshot" })
      )

      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        const first = yield* store.readAttempt(attempt.runId, attempt.attemptId).pipe(Effect.exit)
        const second = yield* store.readServerLaunch().pipe(Effect.exit)
        const third = yield* store.writeServerLaunch(launch).pipe(Effect.exit)
        expect(Exit.isFailure(first)).toBe(true)
        expect(Exit.isFailure(second)).toBe(true)
        expect(Exit.isFailure(third)).toBe(true)
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

it.effect("keeps memory attempt, launch, and lease facts exact across replacement and release", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    expect(Option.isNone(yield* store.readAttempt(attempt.runId, attempt.attemptId))).toBe(true)

    yield* store.writeAttempt(associated)
    expect(yield* store.readAttempt(attempt.runId, attempt.attemptId)).toEqual(Option.some(associated))

    yield* store.writeServerLaunch(launch)
    expect(yield* store.readServerLaunch()).toEqual(Option.some(launch))
    yield* store.clearServerLaunch(CodexServerIncarnation.make("foreign-incarnation"))
    expect(yield* store.readServerLaunch()).toEqual(Option.some(launch))
    yield* store.clearServerLaunch(launch.incarnation)
    expect(Option.isNone(yield* store.readServerLaunch())).toBe(true)

    yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
    yield* store.acquireServerLease(leaseOwner, () => Effect.die("same owner must not observe"))
    const replaced = yield* store.acquireServerLease(otherLeaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
    expect(replaced).toBeUndefined()

    const oldOwnerRelease = yield* store.releaseServerLease(leaseOwner).pipe(Effect.exit)
    expect(Exit.isFailure(oldOwnerRelease)).toBe(true)
    yield* store.releaseServerLease(otherLeaseOwner)
    yield* store.releaseServerLease(otherLeaseOwner)

    yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "ExactLive" as const })).pipe(Effect.exit)
    const exactLive = yield* store
      .acquireServerLease(otherLeaseOwner, () => Effect.succeed({ _tag: "ExactLive" as const }))
      .pipe(Effect.exit)
    expect(Exit.isFailure(exactLive)).toBe(true)
    yield* store.releaseServerLease(leaseOwner)

    yield* store
      .acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Unreadable", detail: "memory unreadable" }))
      .pipe(Effect.exit)
    const unreadable = yield* store
      .acquireServerLease(otherLeaseOwner, () =>
        Effect.succeed({ _tag: "Unreadable", detail: "memory unreadable" } as const)
      )
      .pipe(Effect.exit)
    expect(Exit.isFailure(unreadable)).toBe(true)
    yield* store.releaseServerLease(leaseOwner)

    yield* store
      .acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Contradictory", detail: "memory contradiction" }))
      .pipe(Effect.exit)
    const contradictory = yield* store
      .acquireServerLease(otherLeaseOwner, () =>
        Effect.succeed({ _tag: "Contradictory", detail: "memory contradiction" } as const)
      )
      .pipe(Effect.exit)
    expect(Exit.isFailure(contradictory)).toBe(true)
  }).pipe(Effect.provide(memoryCodexAttemptStoreLayer()))
)

it.effect("loads initial memory snapshot associations and launch ownership", () =>
  Effect.gen(function* () {
    const store = yield* CodexAttemptStore
    expect(yield* store.readAttempt(attempt.runId, attempt.attemptId)).toEqual(Option.some(associated))
    expect(yield* store.readServerLaunch()).toEqual(Option.some(launch))
  }).pipe(
    Effect.provide(memoryCodexAttemptStoreLayer({ attempts: [associated], serverLaunch: launch, replacements: [] }))
  )
)

it.effect("rejects impossible private record and launch combinations before they can be stored", () =>
  Effect.gen(function* () {
    const acceptedReference = EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
    const validTerminal = {
      _tag: "Terminal" as const,
      attemptId: attempt.attemptId,
      correlationAttemptId: attempt.attemptId,
      correlationRunId: attempt.runId,
      currentToken: CodexOwnedTurnToken.make("token-58"),
      evidenceManifest: acceptedReference,
      observedTurnId: CodexTurnId.make("turn-58"),
      priorObservedTurnId: null,
      terminal: CodexSealedTerminal.cases.Accepted.make({
        commit: attempt.baseSha,
        evidenceManifest: acceptedReference
      }),
      threadId: associated.threadId,
      worktree: attempt.worktree
    }
    expect(Schema.decodeUnknownSync(CodexAttemptRecord)(validTerminal)).toEqual(validTerminal)
    const invalidCorrelation = { ...associated, correlationAttemptId: AttemptId.make("attempt:issue-58-store:foreign") }
    expect(() => Schema.decodeUnknownSync(CodexAttemptRecord)(invalidCorrelation)).toThrow()
    expect(
      Schema.decodeUnknownSync(CodexAttemptRecord)({ ...associated, evidenceManifest: acceptedReference })
    ).toEqual(associated)
    expect(() =>
      Schema.decodeUnknownSync(CodexAttemptRecord)({
        ...validTerminal,
        terminal: validTerminal.terminal,
        evidenceManifest: null
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(CodexAttemptRecord)({
        ...validTerminal,
        evidenceManifest: acceptedReference,
        terminal: CodexSealedTerminal.cases.Failed.make({})
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(CodexAttemptRecord)({
        ...validTerminal,
        evidenceManifest: acceptedReference,
        terminal: CodexSealedTerminal.cases.Accepted.make({
          commit: attempt.baseSha,
          evidenceManifest: EvidenceReference.make({ byteLength: 2, digest: EvidenceDigest.make("b".repeat(64)) })
        })
      })
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(CodexServerLaunchRecord)({ ...launch, phase: "Launching", pid: 1 })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(CodexServerLaunchRecord)({ ...launch, phase: "Spawned", pid: null })
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(CodexServerLaunchRecord)({ ...launch, phase: "Live", pid: null })).toThrow()
    expect(
      Schema.decodeUnknownSync(CodexServerLaunchRecord)({ ...launch, phase: "Launching", pid: null })
    ).toMatchObject({ phase: "Launching", pid: null })
    expect(Schema.decodeUnknownSync(CodexServerLaunchRecord)({ ...launch, phase: "Spawned", pid: 2 })).toMatchObject({
      phase: "Spawned",
      pid: 2
    })
    yield* Effect.void
  })
)

it.effect("persists an immutable purged-unit replacement ledger and reopens it exactly", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-111-ledger-" })
      const storePath = path.join(root, "executor-private-state.json")
      const requestId = CodexReplacementRequestId.make("replacement-request-111")
      const operationId = CodexReplacementOperationId.make("replacement-operation-111")
      const predecessorTurnId = CodexTurnId.make("codex-turn-u1")
      const predecessorToken = CodexOwnedTurnToken.make("codex-token-u1")
      const replacementToken = CodexOwnedTurnToken.make("codex-token-u2")
      const replacementTurnId = CodexTurnId.make("codex-turn-u2")
      const evidence = CodexPurgedWorkUnitEvidence.make({
        predecessorToken,
        predecessorTurnId,
        threadId: associated.threadId,
        worktree: attempt.worktree
      })
      const purged = CodexReplacementHistoryEntry.cases.Purged.make({ evidence })
      const intent = CodexReplacementHistoryEntry.cases.IntentRecorded.make({
        operationId,
        requestDigest: CodexReplacementRequestDigest.make("a".repeat(64)),
        requestId
      })
      const turnIntent = CodexReplacementHistoryEntry.cases.TurnIntentRecorded.make({ operationId, replacementToken })
      const turnCalled = CodexReplacementHistoryEntry.cases.TurnBoundaryCrossingBegan.make({
        operationId,
        replacementToken
      })
      const observed = CodexReplacementHistoryEntry.cases.TurnObserved.make({
        operationId,
        replacementToken,
        replacementTurnId
      })
      const sealed = CodexReplacementHistoryEntry.cases.Sealed.make({
        operationId,
        replacementToken,
        replacementTurnId
      })
      const ledger = CodexPurgedWorkUnitReplacementLedger.make({
        history: [purged, intent, turnIntent, turnCalled, observed, sealed],
        operationId,
        plannedAttempt: attempt,
        requestId
      })
      const intentLedger = CodexPurgedWorkUnitReplacementLedger.make({
        history: [purged, intent],
        operationId,
        plannedAttempt: attempt,
        requestId
      })
      const turnIntentLedger = CodexPurgedWorkUnitReplacementLedger.make({
        history: [purged, intent, turnIntent],
        operationId,
        plannedAttempt: attempt,
        requestId
      })

      yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        expect(yield* store.readReplacementLedger(requestId)).toEqual(Option.some(intentLedger))
        expect(
          Option.isNone(yield* store.readReplacementLedger(CodexReplacementRequestId.make("replacement-request-none")))
        ).toBe(true)
        yield* store.appendReplacementLedger(intentLedger)
        yield* store.appendReplacementLedger(turnIntentLedger)
        expect(yield* store.readReplacementLedger(requestId)).toEqual(Option.some(turnIntentLedger))
        expect((yield* store.appendReplacementLedger(ledger).pipe(Effect.exit))._tag).toBe("Failure")
      }).pipe(
        Effect.provide(memoryCodexAttemptStoreLayer({ attempts: [], serverLaunch: null, replacements: [intentLedger] }))
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          yield* store.appendReplacementLedger(ledger)
          yield* store.appendReplacementLedger(ledger)
          const foreignOperationId = CodexReplacementOperationId.make("replacement-operation-foreign")
          const conflictingLedger = CodexPurgedWorkUnitReplacementLedger.make({
            history: [
              purged,
              CodexReplacementHistoryEntry.cases.IntentRecorded.make({
                operationId: foreignOperationId,
                requestDigest: CodexReplacementRequestDigest.make("b".repeat(64)),
                requestId
              })
            ],
            operationId: foreignOperationId,
            plannedAttempt: attempt,
            requestId
          })
          expect((yield* store.appendReplacementLedger(conflictingLedger).pipe(Effect.exit))._tag).toBe("Failure")
        }).pipe(Effect.provide(nodeLayer(storePath)))
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* CodexAttemptStore
          const read = yield* store.readReplacementLedger(requestId)
          expect(read).toEqual(Option.some(ledger))
          expect(read._tag === "Some" ? read.value.history[0] : undefined).toEqual(purged)
          expect(read._tag === "Some" ? read.value.history.at(-1) : undefined).toEqual(sealed)
        }).pipe(Effect.provide(nodeLayer(storePath)))
      )
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
