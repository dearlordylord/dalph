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
  CodexServerIncarnation,
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
const associated = CodexAttemptRecord.make({
  attemptId: attempt.attemptId,
  correlationAttemptId: attempt.attemptId,
  correlationRunId: attempt.runId,
  evidenceManifest: null,
  phase: "AssociatedPreTurn",
  terminal: null,
  threadId: CodexThreadId.make("private-thread-58"),
  turnId: null,
  turnMayHaveStarted: false,
  worktree: attempt.worktree
})
const launch = CodexServerLaunchRecord.make({
  command: ["codex", "app-server"],
  incarnation: CodexServerIncarnation.make("private-incarnation-58"),
  phase: "Live",
  pid: 12345
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
