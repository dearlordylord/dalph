import { it } from "@effect/vitest"
import { Schema } from "effect"
import { expect } from "vitest"
import {
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorProjection,
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

it.each([
  PlannedAttemptExecutorProjection.cases.Exact.make({
    report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
  }),
  PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
  PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation }),
  PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation }),
  PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
    expected: correlation,
    observed: PlannedAttemptExecutorReport.cases.Running.make({
      correlation: { attemptId: AttemptId.make("foreign-attempt"), runId: correlation.runId }
    })
  })
])("roundtrips the $._tag normalized executor projection", (projection) => {
  expect(
    Schema.decodeUnknownSync(PlannedAttemptExecutorProjection)(
      Schema.encodeUnknownSync(PlannedAttemptExecutorProjection)(projection)
    )
  ).toEqual(projection)
})

it("rejects a contradiction that does not contain a foreign observed report", () => {
  expect(() =>
    Schema.decodeUnknownSync(PlannedAttemptExecutorProjection)({
      _tag: "CorrelationContradiction",
      expected: correlation,
      observed: { _tag: "Running", correlation }
    })
  ).toThrow()
})

it("roundtrips a provider-neutral exact command failure", () => {
  const failure = new PlannedAttemptExecutorCommandFailure({
    command: "StartOrContinue",
    correlation,
    detail: "the injected boundary declined the command"
  })
  expect(
    Schema.decodeUnknownSync(PlannedAttemptExecutorCommandFailure)(
      Schema.encodeUnknownSync(PlannedAttemptExecutorCommandFailure)(failure)
    )
  ).toEqual(failure)
})
