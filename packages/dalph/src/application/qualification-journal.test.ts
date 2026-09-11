import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  AcceptedJournalReader,
  JournalDatabaseLocator,
  beginPlannedAttemptExecutorWork,
  plannedAttemptProtocolControllerLayer
} from "@dalph/orchestrator"
import { NodeServices } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Ref } from "effect"
import { describe, expect } from "vitest"
import { qualificationWorkflowJournalLayer } from "./qualification-journal.js"

const runId = RunId.make("qualification-live-journal-test")
const taskId = TaskId.make("qualification-task")
const specification = makeTaskWorkSpecification({ body: "Qualify Codex.", taskId, title: "Qualification" })
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("qualification-attempt"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/qualification"),
  executor: TaskExecutorLocator.make("executor:qualification"),
  runId,
  taskId,
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/qualification")
})

describe("qualification workflow journal", () => {
  it.effect("begins from the complete accepted plan and cold-imports it exactly once after restart", () =>
    Effect.gen(function* () {
      const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
        prefix: "dalph-qualification-journal-"
      })
      const filename = JournalDatabaseLocator.make(`${directory}/qualification.sqlite`)
      const beginCalls = yield* Ref.make(0)
      const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
        correlation: plannedAttemptExecutorCorrelation(attempt)
      })
      const executor = PlannedAttemptExecutor.of({
        begin: () => Ref.update(beginCalls, (count) => count + 1).pipe(Effect.as(executing)),
        observe: () => Effect.die("qualification Begin must not project an unrelated executor"),
        requestSuspension: () => Effect.die("qualification Begin must not suspend executor work"),
        resume: () => Effect.die("qualification Begin must not resume executor work")
      })
      const live = qualificationWorkflowJournalLayer({ attempt, filename, specification }).pipe(
        Layer.provideMerge(plannedAttemptProtocolControllerLayer)
      )

      const crashed = yield* Effect.scoped(
        Effect.gen(function* () {
          const accepted = yield* AcceptedJournalReader
          expect((yield* accepted.readAccepted(runId)).lastPosition).toBe(10)
          expect(yield* beginPlannedAttemptExecutorWork(attempt, specification)).toEqual(executing)
          expect((yield* accepted.readAccepted(runId)).lastPosition).toBe(14)
          return yield* Effect.die("simulated qualification host crash after durable Begin")
        }).pipe(Effect.provideService(PlannedAttemptExecutor, executor), Effect.provide(live))
      ).pipe(Effect.exit)
      expect(crashed._tag).toBe("Failure")

      yield* Effect.scoped(
        Effect.gen(function* () {
          const accepted = yield* AcceptedJournalReader
          expect((yield* accepted.readAccepted(runId)).lastPosition).toBe(14)
        }).pipe(Effect.provide(live))
      )
      expect(yield* Ref.get(beginCalls)).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )
})
