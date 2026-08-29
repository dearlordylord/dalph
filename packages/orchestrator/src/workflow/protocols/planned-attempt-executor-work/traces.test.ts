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

it.effect("keeps begin, suspension, resume, and passive observation as distinct boundary operations", () =>
  Effect.gen(function* () {
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const safelySuspended = PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    const layer = makeControlledFakePlannedAttemptExecutorLayer([
      ControlledFakeExecutorStep.cases.Begin.make({ correlation, report: executing }),
      ControlledFakeExecutorStep.cases.Suspend.make({ correlation, report: safelySuspended }),
      ControlledFakeExecutorStep.cases.Resume.make({ correlation, report: terminal })
    ])
    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      expect(yield* executor.begin(request)).toEqual(executing)
      expect(yield* executor.requestSuspension(plannedAttempt)).toEqual(safelySuspended)
      expect(yield* executor.resume(request)).toEqual(terminal)
      expect(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(
        PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal })
      )
    }).pipe(Effect.provide(layer))
  })
)
