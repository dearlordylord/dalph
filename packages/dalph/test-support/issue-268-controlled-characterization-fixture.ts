import { AttemptId, PlannedTaskAttempt, TaskBranchRef, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import { type MaterializedDeliveryAction, PlannedTaskAttemptPlanner } from "@dalph/orchestrator"
import { Effect, Layer, Ref } from "effect"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"

const attemptIdByTaskId = new Map([
  [scenario.taskIds.A, scenario.attempts.A1],
  [scenario.taskIds.B, scenario.attempts.B1],
  [scenario.taskIds.C, scenario.attempts.C1],
  [scenario.taskIds.D, scenario.attempts.D1],
  [scenario.taskIds.E, AttemptId.make("attempt:E:1")]
])

export const fixedAttemptPlannerLayer = Layer.effect(
  PlannedTaskAttemptPlanner,
  Effect.gen(function* () {
    const plans = yield* Ref.make<ReadonlyMap<string, PlannedTaskAttempt>>(new Map())
    return PlannedTaskAttemptPlanner.of({
      plan: (request) =>
        Effect.gen(function* () {
          const taskId = request.specification.taskId
          const attemptId = attemptIdByTaskId.get(taskId)
          if (attemptId === undefined) return yield* Effect.die(`unknown C2b task ${taskId}`)
          const existing = (yield* Ref.get(plans)).get(taskId)
          if (existing !== undefined) return existing
          const planned = PlannedTaskAttempt.make({
            attemptId,
            baseSha: request._tag === "Fresh" ? scenario.baseSha : request.baseSha,
            branch: TaskBranchRef.make(`refs/heads/dalph/issue-268-${taskId.toLowerCase()}-1`),
            executor: TaskExecutorLocator.make("executor:issue-268-controlled"),
            runId: scenario.runId,
            taskId,
            taskRevision: request.specification.fingerprint,
            worktree: WorktreeLocator.make(`/dalph/controlled-characterization/issue-268/${taskId}-1`)
          })
          yield* Ref.update(plans, (current) => new Map(current).set(taskId, planned))
          return planned
        })
    })
  })
)

export const selectedTaskIds = [scenario.taskIds.A, scenario.taskIds.B, scenario.taskIds.C] as const

export const requireExactlySelectedTaskIds = (checkpoint: string, observed: ReadonlyArray<string>) =>
  observed.length === selectedTaskIds.length && selectedTaskIds.every((taskId) => observed.includes(taskId))
    ? Effect.void
    : Effect.die(`${checkpoint} expected only A/B/C, observed ${observed.join(",")}`)

export const releaseFor = <A>(
  taskId: string,
  controls: { readonly A: A; readonly B: A; readonly C: A }
): A | undefined =>
  taskId === scenario.taskIds.A
    ? controls.A
    : taskId === scenario.taskIds.B
      ? controls.B
      : taskId === scenario.taskIds.C
        ? controls.C
        : undefined

export const actionStage = (action: MaterializedDeliveryAction) => {
  const route = action.proposal.route
  return "step" in route ? { stage: route.step._tag, taskId: route.step.task.id } : undefined
}

export const suspendCommandOrdinal = 2
