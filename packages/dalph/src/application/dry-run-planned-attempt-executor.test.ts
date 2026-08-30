import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorRequest,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import { dryRunPlannedAttemptExecutorLayer } from "./dry-run-planned-attempt-executor.js"
import { plannedAttemptExecutorContract } from "../../../orchestrator/test/contracts/planned-attempt-executor-contract.js"

plannedAttemptExecutorContract({ layer: dryRunPlannedAttemptExecutorLayer, name: "controlled" })

const specification = makeTaskWorkSpecification({
  body: "Dry-run body",
  taskId: TaskId.make("dry-run-task"),
  title: "Dry-run task"
})
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:dry-run:0"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/dry-run"),
  executor: TaskExecutorLocator.make("executor:dry-run"),
  runId: RunId.make("dry-run"),
  taskId: TaskId.make("dry-run-task"),
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/dry-run")
})
const correlation = plannedAttemptExecutorCorrelation(attempt)
const request = PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification })

it.effect("keeps the dry-run executor deterministic without selecting a production implementation", () =>
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(
      PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
    )

    const running = yield* executor.begin(request)
    expect(running).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
      correlation,
      result: { _tag: "Completed" }
    })
    expect(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({ report: terminal })
    )
  }).pipe(Effect.provide(dryRunPlannedAttemptExecutorLayer))
)

it.effect("records suspension and resume reports for the same exact attempt", () =>
  Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request)

    const safelySuspended = yield* executor.requestSuspension(attempt)
    expect(safelySuspended).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    )
    expect(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({ report: safelySuspended })
    )

    const resumed = yield* executor.resume(request)
    expect(resumed).toEqual(PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    expect(yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({ report: resumed })
    )
  }).pipe(Effect.provide(dryRunPlannedAttemptExecutorLayer))
)
