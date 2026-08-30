import { it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorRequest,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"

interface PlannedAttemptExecutorContractInput<E> {
  readonly layer: Layer.Layer<PlannedAttemptExecutor, E, never>
  readonly name: string
}

const contractShaLength = 40

/** Shared executor boundary contract used by dry-run and Codex implementations. */
export const plannedAttemptExecutorContract = <E>({ layer, name }: PlannedAttemptExecutorContractInput<E>): void => {
  it.effect(`${name} PlannedAttemptExecutor begins once and projects the exact correlated work`, () =>
    Effect.gen(function* () {
      const specification = makeTaskWorkSpecification({
        body: "contract body",
        taskId: TaskId.make("contract-task"),
        title: "contract task"
      })
      const attempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("attempt:capability-contract"),
        baseSha: GitCommitSha.make("1".repeat(contractShaLength)),
        branch: TaskBranchRef.make("refs/heads/dalph/capability-contract"),
        executor: TaskExecutorLocator.make("executor:capability-contract"),
        runId: RunId.make("run:capability-contract"),
        taskId: specification.taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make("/worktrees/capability-contract")
      })
      const request = PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification })
      const correlation = plannedAttemptExecutorCorrelation(attempt)
      const executor = yield* PlannedAttemptExecutor
      expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
        PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
      )
      expect(yield* executor.begin(request)).toEqual(
        PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      )
      const projection = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
      expect(projection._tag).toBe("Exact")
      if (projection._tag !== "Exact") return yield* Effect.die("the executor must project the work it just began")
      expect(projection.report.correlation).toEqual(correlation)
    }).pipe(Effect.provide(layer))
  )
}
