import { Context, Crypto, Effect, Layer, Ref, Schema } from "effect"
import type { GitCommitSha, RunId, Task } from "./domain.js"
import { AttemptId, OperationId, PlannedTaskAttempt, TaskBranchRef, WorktreeLocator } from "./domain.js"

interface OperationIdAllocatorService {
  readonly allocate: () => Effect.Effect<OperationId>
}

/** Allocates identities only when a genuinely new workflow operation is selected. */
export class OperationIdAllocator extends Context.Service<
  OperationIdAllocator,
  OperationIdAllocatorService
>()("@dalph/OperationIdAllocator") {}

export const freshOperationIdAllocatorLayer = Layer.effect(
  OperationIdAllocator,
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    return OperationIdAllocator.of({
      allocate: Effect.fn("OperationIdAllocator.Fresh.allocate")(function*() {
        return OperationId.make(yield* crypto.randomUUIDv7.pipe(Effect.orDie))
      })
    })
  })
)

export const deterministicOperationIdAllocatorLayer = (
  prefix: string
) =>
  Layer.effect(
    OperationIdAllocator,
    Effect.gen(function*() {
      const next = yield* Ref.make(0)
      const allocate = Effect.fn(
        "OperationIdAllocator.Deterministic.allocate"
      )(function*() {
        const ordinal = yield* Ref.getAndUpdate(next, (value) => value + 1)
        return OperationId.make(`${prefix}:${ordinal}`)
      })
      return OperationIdAllocator.of({ allocate })
    })
  )

/** Planning failed before any task-work start intent or request existed. */
export class PlannedTaskAttemptError extends Schema.TaggedErrorClass<PlannedTaskAttemptError>()(
  "PlannedTaskAttemptError",
  { detail: Schema.String }
) {}

interface PlannedTaskAttemptPlannerService {
  readonly plan: (
    task: Task
  ) => Effect.Effect<PlannedTaskAttempt, PlannedTaskAttemptError>
}

/** Selects one exact Base SHA and worktree/branch locator set for a task attempt. */
export class PlannedTaskAttemptPlanner extends Context.Service<
  PlannedTaskAttemptPlanner,
  PlannedTaskAttemptPlannerService
>()("@dalph/PlannedTaskAttemptPlanner") {}

interface DeterministicPlannedTaskAttemptOptions {
  readonly baseSha: GitCommitSha
  readonly runId: RunId
  readonly worktreeRoot: WorktreeLocator
}

export const deterministicPlannedTaskAttemptLayer = (
  options: DeterministicPlannedTaskAttemptOptions
) =>
  Layer.succeed(
    PlannedTaskAttemptPlanner,
    PlannedTaskAttemptPlanner.of({
      plan: Effect.fn("PlannedTaskAttemptPlanner.Deterministic.plan")(function*(task) {
        return PlannedTaskAttempt.make({
          attemptId: AttemptId.make(`attempt:${task.id}`),
          baseSha: options.baseSha,
          branch: TaskBranchRef.make(`refs/heads/dalph/${task.id}`),
          runId: options.runId,
          taskId: task.id,
          worktree: WorktreeLocator.make(`${options.worktreeRoot}/${task.id}`)
        })
      })
    })
  )
