import { it } from "@effect/vitest"
import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorRequest,
  PlannedAttemptExecutorProjection,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import {
  ControlledFakeExecutorStep,
  makeControlledFakePlannedAttemptExecutorLayer
} from "../../../../test/controlled-planned-attempt-executor.js"
import { Effect } from "effect"
import { expect } from "vitest"

const modelSpecification = makeTaskWorkSpecification({
  body: "Model body",
  taskId: TaskId.make("model-task"),
  title: "Model task"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("model-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/model-attempt"),
  executor: TaskExecutorLocator.make("executor:model"),
  runId: RunId.make("model-run"),
  taskId: TaskId.make("model-task"),
  taskRevision: modelSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/model-attempt")
})

const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
const request = PlannedAttemptExecutorRequest.make({ plannedAttempt, specification: modelSpecification })

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
          expect(yield* executor.startOrContinue(request)).toEqual(report)
        }
        const lastReport = reports.at(-1)
        if (lastReport === undefined) return yield* Effect.die("executor trace must include a terminal report")
        expect(yield* executor.project(correlation)).toEqual(
          PlannedAttemptExecutorProjection.cases.Exact.make({ report: lastReport })
        )
      }).pipe(Effect.provide(layer))
    }
  })
)
