import { Context, Crypto, Effect, Layer, Ref, Schema } from "effect"
import { type GitCommitSha, type RunId, type TaskExecutorLocator } from "@dalph/contracts"
import { AttemptId, PlannedTaskAttempt, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { OperationId } from "../../identity.js"
import type { TaskWorkSpecification } from "../../../authorities/task-tracker/task-work-specification.js"

export interface OperationIdAllocatorService {
  readonly allocate: () => Effect.Effect<OperationId>
}

/** Allocates identities only when a genuinely new workflow operation is selected. */
export class OperationIdAllocator extends Context.Service<OperationIdAllocator, OperationIdAllocatorService>()(
  "@dalph/OperationIdAllocator"
) {}

export const freshOperationIdAllocatorLayer = Layer.effect(
  OperationIdAllocator,
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    return OperationIdAllocator.of({
      allocate: Effect.fn("OperationIdAllocator.Fresh.allocate")(function* () {
        return OperationId.make(yield* crypto.randomUUIDv7.pipe(Effect.orDie))
      })
    })
  })
)

export const deterministicOperationIdAllocatorLayer = (prefix: string) =>
  Layer.effect(
    OperationIdAllocator,
    Effect.gen(function* () {
      const next = yield* Ref.make(0)
      const allocate = Effect.fn("OperationIdAllocator.Deterministic.allocate")(function* () {
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

export interface PlannedTaskAttemptPlannerService {
  readonly plan: (specification: TaskWorkSpecification) => Effect.Effect<PlannedTaskAttempt, PlannedTaskAttemptError>
}

/** Selects one exact Base SHA and worktree/branch locator set for a task attempt. */
export class PlannedTaskAttemptPlanner extends Context.Service<
  PlannedTaskAttemptPlanner,
  PlannedTaskAttemptPlannerService
>()("@dalph/PlannedTaskAttemptPlanner") {}

interface DeterministicPlannedTaskAttemptOptions {
  readonly baseSha: GitCommitSha
  readonly executor: TaskExecutorLocator
  readonly runId: RunId
  readonly worktreeRoot: WorktreeLocator
}

export const deterministicPlannedTaskAttemptLayer = (options: DeterministicPlannedTaskAttemptOptions) =>
  Layer.effect(
    PlannedTaskAttemptPlanner,
    Effect.gen(function* () {
      const nextAttemptOrdinal = yield* Ref.make(0)
      return PlannedTaskAttemptPlanner.of({
        plan: Effect.fn("PlannedTaskAttemptPlanner.Deterministic.plan")(function* (specification) {
          const ordinal = yield* Ref.getAndUpdate(nextAttemptOrdinal, (current) => current + 1)
          const attemptId = AttemptId.make(`attempt:${specification.taskId}:${ordinal}`)
          const resourceSegment = `attempt-${encodeURIComponent(specification.taskId)}-${ordinal}`
          return PlannedTaskAttempt.make({
            attemptId,
            baseSha: options.baseSha,
            branch: TaskBranchRef.make(`refs/heads/dalph/${resourceSegment}`),
            executor: options.executor,
            runId: options.runId,
            taskId: specification.taskId,
            taskRevision: specification.fingerprint,
            worktree: WorktreeLocator.make(`${options.worktreeRoot}/${resourceSegment}`)
          })
        })
      })
    })
  )
