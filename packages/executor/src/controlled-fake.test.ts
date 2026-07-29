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
import { Effect, Option, Schema } from "effect"
import { expect } from "vitest"
import {
  ControlledFakeExecutorStep,
  controlledFakePlannedAttemptExecutorLayer,
  makeControlledFakePlannedAttemptExecutorLayer
} from "./controlled-fake.js"

const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-A-3"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/attempt-A-3"),
  executor: TaskExecutorLocator.make("executor:controlled-fake"),
  runId: RunId.make("R"),
  taskId: TaskId.make("A"),
  taskRevision: TaskRevision.make("task-A-revision"),
  worktree: WorktreeLocator.make("/worktrees/attempt-A-3")
})
const correlation = plannedAttemptExecutorCorrelation(attempt)

it.effect("executes and validates deterministic controlled-fake cassettes", () =>
  Effect.gen(function* () {
    const running = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.project(correlation)).toEqual(Option.none())
    expect(yield* executor.startOrContinue(attempt)).toEqual(running)
    expect(yield* executor.startOrContinue(attempt)).toEqual(terminal)
    expect(yield* executor.project(correlation)).toEqual(Option.some(terminal))
    expect((yield* executor.startOrContinue(attempt).pipe(Effect.flip)).detail).toContain("has no cassette entry")

    const wrongKind = yield* PlannedAttemptExecutor.pipe(
      Effect.flatMap((service) => service.startOrContinue(attempt)),
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Suspend.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
          })
        ])
      ),
      Effect.flip
    )
    expect(wrongKind.detail).toContain("expected Suspend")

    const suspended = yield* PlannedAttemptExecutor.pipe(
      Effect.flatMap((service) => service.requestSuspension(attempt)),
      Effect.provide(
        makeControlledFakePlannedAttemptExecutorLayer([
          ControlledFakeExecutorStep.cases.Suspend.make({
            correlation,
            report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
          })
        ])
      )
    )
    expect(suspended._tag).toBe("SafelySuspended")

    const invalidStep = yield* Schema.decodeUnknownEffect(ControlledFakeExecutorStep)({
      _tag: "StartOrContinue",
      correlation,
      report: { _tag: "Running", correlation: { ...correlation, attemptId: AttemptId.make("different") } }
    }).pipe(Effect.flip)
    expect(String(invalidStep)).toContain("same planned attempt")
  }).pipe(
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Running.make({ correlation })
        }),
        ControlledFakeExecutorStep.cases.StartOrContinue.make({
          correlation,
          report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
        })
      ])
    )
  )
)

it.effect("projects running, terminal, and safely suspended reports from the milestone fake", () =>
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.project(correlation)).toEqual(Option.none())
    expect((yield* executor.startOrContinue(attempt))._tag).toBe("Running")
    expect((yield* executor.startOrContinue(attempt))._tag).toBe("Terminal")
    const suspended = yield* executor.requestSuspension(attempt)
    expect(suspended._tag).toBe("SafelySuspended")
    expect(yield* executor.project(correlation)).toEqual(Option.some(suspended))
  }).pipe(Effect.provide(controlledFakePlannedAttemptExecutorLayer))
)
