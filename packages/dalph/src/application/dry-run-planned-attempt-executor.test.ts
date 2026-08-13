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
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import { dryRunPlannedAttemptExecutorLayer } from "./dry-run-planned-attempt-executor.js"

const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:dry-run:0"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/dry-run"),
  executor: TaskExecutorLocator.make("executor:dry-run"),
  runId: RunId.make("dry-run"),
  taskId: TaskId.make("dry-run-task"),
  taskRevision: TaskRevision.make("dry-run-revision"),
  worktree: WorktreeLocator.make("/worktrees/dry-run")
})
const correlation = plannedAttemptExecutorCorrelation(attempt)

it.effect("keeps the dry-run executor deterministic without selecting a production implementation", () =>
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.project(correlation)).toEqual(Option.none())

    const running = yield* executor.startOrContinue(attempt)
    expect(running).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    expect(yield* executor.project(correlation)).toEqual(Option.some(running))

    const terminal = yield* executor.startOrContinue(attempt)
    expect(terminal).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
    )

    const safelySuspended = yield* executor.requestSuspension(attempt)
    expect(safelySuspended).toEqual(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
    expect(yield* executor.project(correlation)).toEqual(Option.some(safelySuspended))
  }).pipe(Effect.provide(dryRunPlannedAttemptExecutorLayer))
)
