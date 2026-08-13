import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
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
import { Effect } from "effect"
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
    expect(yield* executor.project(correlation)).toEqual(
      PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
    )

    const running = yield* executor.startOrContinue(attempt)
    expect(running).toEqual(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
    expect(yield* executor.project(correlation)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({ report: running })
    )

    const terminal = yield* executor.startOrContinue(attempt)
    expect(terminal).toEqual(
      PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
    )
    expect(yield* executor.project(correlation)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal })
    )

    const safelySuspended = yield* executor.requestSuspension(attempt)
    expect(safelySuspended).toEqual(PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
    expect(yield* executor.project(correlation)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({ report: safelySuspended })
    )
  }).pipe(Effect.provide(dryRunPlannedAttemptExecutorLayer))
)
