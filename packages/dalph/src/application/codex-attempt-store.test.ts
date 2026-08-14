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
import { Effect, Exit, FileSystem, Layer, Option, Path } from "effect"
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

const nodeLayer = (storePath: string) => nodeCodexAttemptStoreLayer(storePath).pipe(Layer.provide(NodeServices.layer))

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
      const first = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
        return store
      }).pipe(Effect.provide(nodeLayer(storePath)))
      const second = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.acquireServerLease(otherLeaseOwner, () => Effect.succeed({ _tag: "ExactLive" as const }))
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(second)).toBe(true)
      yield* first.releaseServerLease(leaseOwner)
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
      yield* fileSystem.writeFileString(`${storePath}.lease`, JSON.stringify(otherLeaseOwner))
      const store = yield* Effect.gen(function* () {
        return yield* CodexAttemptStore
      }).pipe(Effect.provide(nodeLayer(storePath)))
      yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "Absent" as const }))
      const foreignRelease = yield* store.releaseServerLease(otherLeaseOwner).pipe(Effect.exit)
      expect(Exit.isFailure(foreignRelease)).toBe(true)
      yield* store.releaseServerLease(leaseOwner)
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
      yield* fileSystem.writeFileString(`${storePath}.lease`, JSON.stringify(otherLeaseOwner))
      const live = yield* Effect.gen(function* () {
        const store = yield* CodexAttemptStore
        return yield* store.acquireServerLease(leaseOwner, () => Effect.succeed({ _tag: "ExactLive" as const }))
      }).pipe(Effect.provide(nodeLayer(storePath)), Effect.exit)
      expect(Exit.isFailure(live)).toBe(true)

      yield* fileSystem.writeFileString(`${storePath}.lease`, "not-json")
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
      yield* fileSystem.writeFileString(storePath, "{not-json")
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
      yield* fileSystem.writeFileString(
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

it.effect("recovers a complete same-directory next snapshot after an interrupted rename", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-58-store-next-" })
      const storePath = path.join(root, "executor-private-state.json")
      yield* fileSystem.writeFileString(
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
      yield* fileSystem.writeFileString(
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
      yield* fileSystem.writeFileString(
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
