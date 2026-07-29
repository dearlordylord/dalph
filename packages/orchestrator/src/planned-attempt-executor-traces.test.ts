import { it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "./domain.js"
import {
  ControlledFakeExecutorStep,
  makeControlledFakePlannedAttemptExecutorLayer,
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport
} from "./planned-attempt-executor.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("model-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/model-attempt"),
  executor: TaskExecutorLocator.make("executor:model"),
  runId: RunId.make("model-run"),
  taskId: TaskId.make("model-task"),
  taskRevision: TaskRevision.make("model-revision"),
  worktree: WorktreeLocator.make("/worktrees/model-attempt")
})

const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)

it.effect("accepts representative coarse executor report traces", () =>
  Effect.gen(function* () {
    const traces: ReadonlyArray<ReadonlyArray<"Running" | "SafelySuspended">> = [
      [],
      ["Running"],
      ["SafelySuspended"],
      ["Running", "Running"],
      ["Running", "SafelySuspended"],
      ["SafelySuspended", "Running"],
      ["Running", "SafelySuspended", "Running"]
    ]
    for (const tags of traces) {
      const reports = [
        ...tags.map((tag) =>
          tag === "Running"
            ? PlannedAttemptExecutorReport.cases.Running.make({ correlation })
            : PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
        ),
        PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
      ]
      const layer = makeControlledFakePlannedAttemptExecutorLayer(
        reports.map((report) => ControlledFakeExecutorStep.cases.StartOrContinue.make({ correlation, report }))
      )
      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        for (const report of reports) {
          expect(yield* executor.startOrContinue(plannedAttempt)).toEqual(report)
        }
        expect(yield* executor.project(correlation)).toEqual(Option.some(reports.at(-1)))
      }).pipe(Effect.provide(layer))
    }
  })
)
