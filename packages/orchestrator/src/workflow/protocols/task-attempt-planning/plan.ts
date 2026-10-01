// @effect-diagnostics lazyEffect:off
import { Context, Crypto, Data, Effect, Layer, Ref, Schema } from "effect"
import { type GitCommitSha, type RunId, type TaskExecutorLocator, type TaskWorkSpecification } from "@dalph/contracts"
import { AttemptId, PlannedTaskAttempt, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { OperationId } from "../../identity.js"

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
export class PlannedTaskAttemptError extends Schema.TaggedError<PlannedTaskAttemptError>()("PlannedTaskAttemptError", {
  detail: Schema.String
}) {}

/** Zero-based durable identity slot for one task's immutable planned attempts. */
export const PlannedTaskAttemptOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("PlannedTaskAttemptOrdinal")
)
export type PlannedTaskAttemptOrdinal = typeof PlannedTaskAttemptOrdinal.Type

/** One fresh plan or one replacement whose exact Base SHA and durable task-local slot travel together. */
export type PlannedTaskAttemptPlanRequest = Data.TaggedEnum<{
  ExactReplacement: {
    readonly baseSha: GitCommitSha
    readonly ordinal: PlannedTaskAttemptOrdinal
    readonly specification: TaskWorkSpecification
  }
  Fresh: { readonly specification: TaskWorkSpecification }
}>
export const PlannedTaskAttemptPlanRequest = Data.taggedEnum<PlannedTaskAttemptPlanRequest>()

export interface PlannedTaskAttemptPlannerService {
  readonly plan: (request: PlannedTaskAttemptPlanRequest) => Effect.Effect<PlannedTaskAttempt, PlannedTaskAttemptError>
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
  /** Uses independent Fresh identity slots for each task in controlled concurrent stories. */
  readonly freshIdentity?: "TaskLocal"
  /** Keeps task-local replacement slots distinct from Run-wide Fresh ordinals in controlled mixed-plan stories. */
  readonly exactReplacementIdentity?: "SeparateNamespace"
}

export const deterministicPlannedTaskAttemptLayer = (options: DeterministicPlannedTaskAttemptOptions) =>
  Layer.effect(
    PlannedTaskAttemptPlanner,
    Effect.gen(function* () {
      const nextAttemptOrdinal = yield* Ref.make(0)
      const nextTaskOrdinals = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
      return PlannedTaskAttemptPlanner.of({
        plan: Effect.fn("PlannedTaskAttemptPlanner.Deterministic.plan")(function* (request) {
          const ordinal =
            options.freshIdentity === "TaskLocal"
              ? yield* Ref.modify(nextTaskOrdinals, (current) => {
                  const taskId = request.specification.taskId
                  const next = current.get(taskId) ?? 0
                  const selected = request._tag === "Fresh" ? next : Number(request.ordinal)
                  return [selected, new Map(current).set(taskId, Math.max(next, selected + 1))] as const
                })
              : yield* Ref.modify(nextAttemptOrdinal, (current) => {
                  const selected = request._tag === "Fresh" ? current : Number(request.ordinal)
                  return [selected, Math.max(current, selected + 1)] as const
                })
          const specification = request.specification
          const identitySlot =
            request._tag === "ExactReplacement" && options.exactReplacementIdentity === "SeparateNamespace"
              ? `replacement:${ordinal}`
              : String(ordinal)
          const attemptId = AttemptId.make(`attempt:${specification.taskId}:${identitySlot}`)
          const resourceSegment = `attempt-${encodeURIComponent(specification.taskId)}-${identitySlot.replaceAll(":", "-")}`
          return PlannedTaskAttempt.make({
            attemptId,
            baseSha: request._tag === "Fresh" ? options.baseSha : request.baseSha,
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
