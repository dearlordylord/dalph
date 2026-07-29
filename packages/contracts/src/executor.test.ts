import { it } from "@effect/vitest"
import { Effect, Layer, Option, Schema } from "effect"
import { expect } from "vitest"
import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey
} from "./executor.js"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "./git-locator.js"
import { AttemptId, PlannedTaskAttempt } from "./planned-attempt.js"
import { TaskId, TaskRevision } from "./task-identity.js"
import { RunId } from "./workflow-identity.js"
import { TaskExecutorLocator } from "./executor-locator.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-A"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A"),
  executor: TaskExecutorLocator.make("executor:contract"),
  runId: RunId.make("run-A"),
  taskId: TaskId.make("task-A"),
  taskRevision: TaskRevision.make("revision-A"),
  worktree: WorktreeLocator.make("/worktrees/attempt-A")
})
const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)

it("derives the executor correlation and stable key only from the planned run and attempt", () => {
  expect(correlation).toEqual({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  expect(plannedAttemptExecutorCorrelationKey(correlation)).toBe(
    JSON.stringify({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })
  )
})

it.each([
  PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
  PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }),
  PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } }),
  PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
])("roundtrips the $._tag executor report through its shared Schema", (report) => {
  expect(
    Schema.decodeUnknownSync(PlannedAttemptExecutorReport)(
      Schema.encodeUnknownSync(PlannedAttemptExecutorReport)(report)
    )
  ).toEqual(report)
})

it.effect("defines an executor interface that a local adapter can implement without another production package", () => {
  const running = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
  const suspended = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
  const terminal = PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
  const localAdapter = Layer.succeed(
    PlannedAttemptExecutor,
    PlannedAttemptExecutor.of({
      project: () => Effect.succeed(Option.some(running)),
      requestSuspension: () => Effect.succeed(suspended),
      startOrContinue: () => Effect.succeed(terminal)
    })
  )

  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.project(correlation)).toEqual(Option.some(running))
    expect(yield* executor.requestSuspension(plannedAttempt)).toEqual(suspended)
    expect(yield* executor.startOrContinue(plannedAttempt)).toEqual(terminal)
  }).pipe(Effect.provide(localAdapter))
})
